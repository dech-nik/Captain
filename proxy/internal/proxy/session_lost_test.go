package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"captain/proxy/internal/ipc"
	"captain/proxy/internal/kubeconfig"
)

func TestLogoutKeepsTeleportContextAndRejectsAuthInsteadOfOffline(t *testing.T) {
	teleport := teleportEntry("teleport-demo", "teleport.example.test:443", "example")
	local := plainEntry("kind-local")
	initial := registryOf("teleport-demo", teleport, local)

	var ipcBuf safeBuffer
	srv := NewServer(initial, "loopback-secret-123", ipc.NewChannel(&ipcBuf))

	afterLogout := registryOf("kind-local", local)
	merged, lost, commit := srv.PlanLoggedOutTeleportContexts(afterLogout)
	if len(lost) != 1 || lost[0].QualifiedName != "teleport-demo" {
		t.Fatalf("lost = %+v, want teleport-demo", namesOf(lost))
	}
	if _, ok := merged.Entries["teleport-demo"]; !ok {
		t.Fatal("logged-out teleport context was dropped from the registry Radar reads")
	}
	if merged.CurrentContext != "teleport-demo" {
		t.Fatalf("current context = %q, want the logged-out teleport context so Radar does not fall onto a stopped local cluster", merged.CurrentContext)
	}

	synth := filepath.Join(t.TempDir(), "kubeconfig")
	if err := kubeconfig.WriteSyntheticKubeconfig(synth, merged, 5444, "loopback-secret-123", []byte("FAKE-CA")); err != nil {
		t.Fatalf("write synthetic kubeconfig: %v", err)
	}
	loaded, err := clientcmd.LoadFromFile(synth)
	if err != nil {
		t.Fatalf("load synthetic kubeconfig: %v", err)
	}
	if _, ok := loaded.Contexts["teleport-demo"]; !ok || loaded.CurrentContext != "teleport-demo" {
		t.Fatalf("synthetic kubeconfig current=%q contexts=%v, want teleport-demo kept for Radar", loaded.CurrentContext, contextNames(loaded))
	}

	commit()
	srv.UpdateRegistry(merged)
	srv.EmitLoggedOutAuth(lost)
	if got := countAuthEvents(ipcBuf.String()); got != 1 {
		t.Fatalf("proactive auth events = %d, want 1; raw=%s", got, ipcBuf.String())
	}

	proxyTS := httptest.NewServer(srv)
	defer proxyTS.Close()

	anonResp, err := http.Get(proxyTS.URL + "/clusters/teleport-demo/version")
	if err != nil {
		t.Fatalf("anon probe: %v", err)
	}
	_ = anonResp.Body.Close()
	if anonResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anon probe status = %d, want 401", anonResp.StatusCode)
	}
	if got := countAuthEvents(ipcBuf.String()); got != 1 {
		t.Fatalf("anonymous probe emitted auth, count=%d raw=%s", got, ipcBuf.String())
	}

	req, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/teleport-demo/version", nil)
	req.Header.Set("Authorization", "Bearer loopback-secret-123")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("auth request: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (offline would be 502); body=%s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("content-type = %q, want application/json so Radar treats the API as reachable", ct)
	}
	if !strings.Contains(string(body), loggedOutAuthReason) {
		t.Fatalf("body = %s, want logout reason", body)
	}
	if got := countAuthEvents(ipcBuf.String()); got != 1 {
		t.Fatalf("auth events = %d, want the proactive event to stay deduped; raw=%s", got, ipcBuf.String())
	}

	_, lostAgain, commitAgain := srv.PlanLoggedOutTeleportContexts(afterLogout)
	commitAgain()
	if len(lostAgain) != 0 {
		t.Fatalf("second reload reported a new logout: %v", namesOf(lostAgain))
	}
}

func TestPartialTeleportRemovalIsNotLogout(t *testing.T) {
	keep := teleportEntry("teleport-keep", "teleport.example.test:443", "example")
	drop := teleportEntry("teleport-drop", "teleport.example.test:443", "example")
	initial := registryOf("teleport-keep", keep, drop)
	srv := NewServer(initial, "token", nil)

	next := registryOf("teleport-keep", keep)
	merged, lost, _ := srv.PlanLoggedOutTeleportContexts(next)
	if len(lost) != 0 {
		t.Fatalf("lost = %v, want none while a sibling cluster on the same proxy remains", namesOf(lost))
	}
	if _, ok := merged.Entries["teleport-drop"]; ok {
		t.Fatal("intentionally removed teleport context was retained")
	}
}

func TestLocalContextRemovalIsNotLogout(t *testing.T) {
	local := plainEntry("kind-local")
	other := plainEntry("kind-other")
	initial := registryOf("kind-local", local, other)
	srv := NewServer(initial, "token", nil)

	next := registryOf("kind-local", local)
	merged, lost, _ := srv.PlanLoggedOutTeleportContexts(next)
	if len(lost) != 0 {
		t.Fatalf("lost = %v, want none for a non-teleport context", namesOf(lost))
	}
	if _, ok := merged.Entries["kind-other"]; ok {
		t.Fatal("removed local context was retained")
	}
	if merged.CurrentContext != "kind-local" {
		t.Fatalf("current context = %q, want kind-local", merged.CurrentContext)
	}
}

func TestUnreachableTeleportProxyStaysOffline(t *testing.T) {
	tmpDir := t.TempDir()
	kcPath := filepath.Join(tmpDir, "config")
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["tp"] = &clientcmdapi.Cluster{
		Server:                "https://127.0.0.1:1",
		InsecureSkipTLSVerify: true,
	}
	cfg.AuthInfos["tp-user"] = &clientcmdapi.AuthInfo{Token: "upstream-token"}
	cfg.Contexts["teleport-demo"] = &clientcmdapi.Context{Cluster: "tp", AuthInfo: "tp-user"}
	cfg.CurrentContext = "teleport-demo"
	if err := clientcmd.WriteToFile(*cfg, kcPath); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}
	reg, err := kubeconfig.LoadRegistry([]string{kcPath})
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	entry := reg.Entries["teleport-demo"]
	entry.Teleport = kubeconfig.TeleportMetadata{
		IsTeleport:      true,
		ProxyAddr:       "teleport.example.test:443",
		TeleportCluster: "example",
		KubeCluster:     "demo",
	}
	reg.Entries["teleport-demo"] = entry

	var ipcBuf safeBuffer
	srv := NewServer(reg, "loopback-secret-123", ipc.NewChannel(&ipcBuf))
	proxyTS := httptest.NewServer(srv)
	defer proxyTS.Close()

	req, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/teleport-demo/version", nil)
	req.Header.Set("Authorization", "Bearer loopback-secret-123")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 for a dial failure that is not a logout; body=%s", resp.StatusCode, body)
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("offline dial failure must stay text/plain, got %q body=%s", resp.Header.Get("Content-Type"), body)
	}
	if countAuthEvents(ipcBuf.String()) != 0 {
		t.Fatalf("unreachable teleport proxy must not open login; raw=%s", ipcBuf.String())
	}
}

func teleportEntry(name, proxyAddr, cluster string) kubeconfig.ContextEntry {
	return kubeconfig.ContextEntry{
		QualifiedName: name,
		InFileName:    name,
		Teleport: kubeconfig.TeleportMetadata{
			IsTeleport:      true,
			ProxyAddr:       proxyAddr,
			TeleportCluster: cluster,
			KubeCluster:     name,
		},
	}
}

func plainEntry(name string) kubeconfig.ContextEntry {
	return kubeconfig.ContextEntry{QualifiedName: name, InFileName: name}
}

func registryOf(current string, entries ...kubeconfig.ContextEntry) *kubeconfig.Registry {
	reg := &kubeconfig.Registry{
		Entries:        make(map[string]kubeconfig.ContextEntry, len(entries)),
		OrderedNames:   make([]string, 0, len(entries)),
		CurrentContext: current,
	}
	for _, entry := range entries {
		reg.Entries[entry.QualifiedName] = entry
		reg.OrderedNames = append(reg.OrderedNames, entry.QualifiedName)
	}
	return reg
}

func namesOf(entries []kubeconfig.ContextEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.QualifiedName)
	}
	return out
}

func contextNames(cfg *clientcmdapi.Config) []string {
	out := make([]string, 0, len(cfg.Contexts))
	for name := range cfg.Contexts {
		out = append(out, name)
	}
	return out
}
