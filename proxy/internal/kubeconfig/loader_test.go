package kubeconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestLoadRegistryAndTeleportDetection(t *testing.T) {
	tmpDir := t.TempDir()
	kc1 := filepath.Join(tmpDir, "teleport-kc.yaml")
	kc2 := filepath.Join(tmpDir, "vanilla-kc.yaml")

	cfg1 := clientcmdapi.NewConfig()
	cfg1.Clusters["example.test-cluster"] = &clientcmdapi.Cluster{
		Server: "https://example.test:443",
	}
	cfg1.AuthInfos["tp-user"] = &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			APIVersion: "client.authentication.k8s.io/v1beta1",
			Command:    "/usr/local/bin/tsh",
			Args: []string{
				"kube",
				"credentials",
				"--kube-cluster=example-cluster",
				"--teleport-cluster=example.test",
				"--proxy=example.test:443",
			},
		},
	}
	cfg1.Contexts["example.test-cluster"] = &clientcmdapi.Context{
		Cluster:   "example.test-cluster",
		AuthInfo:  "tp-user",
		Namespace: "example",
	}
	cfg1.CurrentContext = "example.test-cluster"
	if err := clientcmd.WriteToFile(*cfg1, kc1); err != nil {
		t.Fatalf("write kc1: %v", err)
	}

	cfg2 := clientcmdapi.NewConfig()
	cfg2.Clusters["local"] = &clientcmdapi.Cluster{
		Server: "https://127.0.0.1:6443",
	}
	cfg2.AuthInfos["local-user"] = &clientcmdapi.AuthInfo{
		Token: "static-token",
	}
	cfg2.Contexts["local"] = &clientcmdapi.Context{
		Cluster:  "local",
		AuthInfo: "local-user",
	}
	if err := clientcmd.WriteToFile(*cfg2, kc2); err != nil {
		t.Fatalf("write kc2: %v", err)
	}

	envList := stringsJoinPaths(kc1, kc2)
	paths := ResolveSourcePaths("", envList)
	if len(paths) != 2 {
		t.Fatalf("expected 2 paths, got %d", len(paths))
	}

	reg, err := LoadRegistry(paths)
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}

	if reg.CurrentContext != "example.test-cluster" {
		t.Fatalf("unexpected current context: %q", reg.CurrentContext)
	}

	tpEntry, ok := reg.Entries["example.test-cluster"]
	if !ok {
		t.Fatalf("missing teleport context")
	}
	if !tpEntry.Teleport.IsTeleport {
		t.Fatalf("expected IsTeleport=true")
	}
	if tpEntry.Teleport.ProxyAddr != "example.test:443" {
		t.Fatalf("unexpected ProxyAddr: %q", tpEntry.Teleport.ProxyAddr)
	}
	if tpEntry.Teleport.TeleportCluster != "example.test" {
		t.Fatalf("unexpected TeleportCluster: %q", tpEntry.Teleport.TeleportCluster)
	}
	if tpEntry.Teleport.KubeCluster != "example-cluster" {
		t.Fatalf("unexpected KubeCluster: %q", tpEntry.Teleport.KubeCluster)
	}

	restCfg, err := BuildRestConfig(tpEntry)
	if err != nil {
		t.Fatalf("BuildRestConfig: %v", err)
	}
	if restCfg.ExecProvider == nil {
		t.Fatalf("expected ExecProvider to be set")
	}
	if restCfg.ExecProvider.InteractiveMode != clientcmdapi.NeverExecInteractiveMode {
		t.Fatalf("expected NeverExecInteractiveMode, got %v", restCfg.ExecProvider.InteractiveMode)
	}

	vanillaEntry := reg.Entries["local"]
	if vanillaEntry.Teleport.IsTeleport {
		t.Fatalf("expected local IsTeleport=false")
	}

	synthPath := filepath.Join(tmpDir, "synthetic", "kubeconfig")
	if err := WriteSyntheticKubeconfig(synthPath, reg, 54321, "loopback-secret", []byte("FAKE-CA")); err != nil {
		t.Fatalf("WriteSyntheticKubeconfig: %v", err)
	}

	if runtime.GOOS != "windows" {
		st, err := os.Stat(synthPath)
		if err != nil {
			t.Fatalf("stat synthetic kubeconfig: %v", err)
		}
		if st.Mode().Perm() != 0600 {
			t.Fatalf("expected 0600 permissions, got %o", st.Mode().Perm())
		}
	}

	synthCfg, err := clientcmd.LoadFromFile(synthPath)
	if err != nil {
		t.Fatalf("load synthetic kubeconfig: %v", err)
	}
	if synthCfg.CurrentContext != "example.test-cluster" {
		t.Fatalf("expected preserved current-context, got %q", synthCfg.CurrentContext)
	}
	if synthCfg.Contexts["example.test-cluster"].Namespace != "example" {
		t.Fatalf("expected preserved namespace 'example', got %q", synthCfg.Contexts["example.test-cluster"].Namespace)
	}
	expectedServer := "https://127.0.0.1:54321/clusters/example.test-cluster"
	if got := synthCfg.Clusters["example.test-cluster"].Server; got != expectedServer {
		t.Fatalf("expected server %q, got %q", expectedServer, got)
	}
}

func stringsJoinPaths(a, b string) string {
	return a + string(os.PathListSeparator) + b
}
