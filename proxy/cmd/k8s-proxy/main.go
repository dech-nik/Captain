package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"captain/proxy/internal/ipc"
	"captain/proxy/internal/kubeconfig"
	"captain/proxy/internal/proxy"
)

func main() {
	// Strictly route all standard Go logging to stderr so stdout remains a pure NDJSON IPC stream.
	log.SetOutput(os.Stderr)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	var (
		kubeconfigFlag    string
		syntheticPathFlag string
		listenPortFlag    int
	)
	flag.StringVar(&kubeconfigFlag, "kubeconfig", "", "Explicit kubeconfig path list (defaults to KUBECONFIG env or ~/.kube/config)")
	flag.StringVar(&syntheticPathFlag, "synthetic-out", "", "Output path for synthetic kubeconfig consumed by Radar")
	flag.IntVar(&listenPortFlag, "port", 0, "Loopback TCP port to listen on (0 = ephemeral free port)")
	flag.Parse()

	sourcePaths := kubeconfig.ResolveSourcePaths(kubeconfigFlag, os.Getenv("KUBECONFIG"))
	reg, err := kubeconfig.LoadRegistry(sourcePaths)
	if err != nil {
		log.Fatalf("[k8s-proxy] failed to load kubeconfig registry: %v", err)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatalf("[k8s-proxy] failed to generate loopback token: %v", err)
	}
	loopbackToken := hex.EncodeToString(tokenBytes)

	loopbackTLS, err := proxy.GenerateLoopbackTLS()
	if err != nil {
		log.Fatalf("[k8s-proxy] failed to generate loopback TLS cert: %v", err)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", listenPortFlag)
	rawLn, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("[k8s-proxy] failed to listen on %s: %v", addr, err)
	}
	actualPort := rawLn.Addr().(*net.TCPAddr).Port
	ln := tls.NewListener(rawLn, loopbackTLS.TLSConfig)

	synthPath := syntheticPathFlag
	createdTempDir := ""
	if synthPath == "" {
		tmpDir, err := os.MkdirTemp("", "captain-kc-*")
		if err != nil {
			log.Fatalf("[k8s-proxy] failed to create temp dir: %v", err)
		}
		createdTempDir = tmpDir
		synthPath = filepath.Join(tmpDir, "kubeconfig")
	}

	cleanup := func() {
		_ = os.Remove(synthPath)
		if createdTempDir != "" {
			_ = os.RemoveAll(createdTempDir)
		}
	}
	defer cleanup()

	if err := kubeconfig.WriteSyntheticKubeconfig(synthPath, reg, actualPort, loopbackToken, loopbackTLS.CertPEM); err != nil {
		log.Fatalf("[k8s-proxy] failed to write synthetic kubeconfig: %v", err)
	}

	ipcChan := ipc.NewChannel(os.Stdout)
	proxySrv := proxy.NewServer(reg, loopbackToken, ipcChan)

	reloadRegistry := func() {
		updated, loadErr := kubeconfig.LoadRegistry(sourcePaths)
		if loadErr != nil {
			log.Printf("[k8s-proxy] reload registry failed: %v", loadErr)
			return
		}
		// Keep vanished Teleport contexts addressable so Radar does not treat `tsh logout` as an
		// offline cluster. Commit that state only after the synthetic kubeconfig write succeeds.
		merged, lost, commit := proxySrv.PlanLoggedOutTeleportContexts(updated)
		if writeErr := kubeconfig.WriteSyntheticKubeconfig(synthPath, merged, actualPort, loopbackToken, loopbackTLS.CertPEM); writeErr != nil {
			log.Printf("[k8s-proxy] rewrite synthetic kubeconfig failed: %v", writeErr)
			return
		}
		commit()
		proxySrv.UpdateRegistry(merged)
		_ = ipcChan.Send(ipc.ContextsUpdatedEvent{
			Type:           "proxy:contexts_updated",
			Contexts:       merged.Summaries(),
			CurrentContext: merged.CurrentContext,
		})
		proxySrv.EmitLoggedOutAuth(lost)
	}

	httpSrv := &http.Server{
		Handler:           proxySrv,
		ReadHeaderTimeout: 15 * time.Second,
	}

	shutdownCtx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	parentClosed := make(chan struct{})
	go ipc.ReadCommands(os.Stdin, func(cmd ipc.InboundCommand) {
		switch cmd.Type {
		case "auth:completed":
			proxySrv.MarkAuthCompleted(cmd.Context)
		case "auth:cancelled":
			proxySrv.MarkAuthCancelled(cmd.Context)
		case "proxy:reload":
			reloadRegistry()
		}
	}, func() {
		close(parentClosed)
	})

	go func() {
		select {
		case <-shutdownCtx.Done():
		case <-parentClosed:
			log.Printf("[k8s-proxy] stdin closed (parent exited); shutting down")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	}()

	if err := ipcChan.Send(ipc.ReadyEvent{
		Type:                "proxy:ready",
		Port:                actualPort,
		SyntheticKubeconfig: synthPath,
		Contexts:            reg.Summaries(),
		CurrentContext:      reg.CurrentContext,
	}); err != nil {
		log.Fatalf("[k8s-proxy] failed to emit ready event: %v", err)
	}

	if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[k8s-proxy] http server error: %v", err)
	}
}
