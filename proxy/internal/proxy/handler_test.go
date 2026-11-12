package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"captain/proxy/internal/ipc"
	"captain/proxy/internal/kubeconfig"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestClassifyTransportError(t *testing.T) {
	cases := []struct {
		name         string
		err          error
		wantRequires bool
	}{
		{
			name:         "tsh exec relogin required",
			err:          errors.New(`Get "https://example.test/api": getting credentials: exec: executable tsh failed with exit code 1: ERROR: relogin required`),
			wantRequires: true,
		},
		{
			name:         "tsh interactive mode blocked",
			err:          errors.New(`exec plugin is configured to use interactive mode, but InteractiveMode is set to Never`),
			wantRequires: true,
		},
		{
			name:         "mTLS bad certificate alert",
			err:          errors.New(`remote error: tls: bad certificate`),
			wantRequires: true,
		},
		{
			name:         "mTLS certificate expired alert",
			err:          errors.New(`remote error: tls: certificate expired`),
			wantRequires: true,
		},
		{
			name:         "tsh v18 no SSH auth methods loaded",
			err:          errors.New("getting credentials: exec: executable /usr/local/bin/tsh failed with exit code 1: \x1b[31mERROR: \x1b[0mno SSH auth methods loaded, are you logged in?\n"),
			wantRequires: true,
		},
		{
			name:         "tsh exec network offline connection refused must NOT falsely ask for login",
			err:          errors.New(`getting credentials: exec: executable tsh failed with exit code 1: ERROR: Get "https://127.0.0.1:59999/webapi/ping": dial tcp 127.0.0.1:59999: connect: connection refused`),
			wantRequires: false,
		},
		{
			name:         "plain network connection refused",
			err:          errors.New(`dial tcp 127.0.0.1:6443: connect: connection refused`),
			wantRequires: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyTransportError(tc.err)
			if got.RequiresAuth != tc.wantRequires {
				t.Fatalf("RequiresAuth = %v, want %v (verdict=%+v)", got.RequiresAuth, tc.wantRequires, got)
			}
		})
	}
}

func TestClassifyHTTPResponse_RBACvsTeleportRevocation(t *testing.T) {
	// 1. Standard Kubernetes RBAC 403 -> MUST NOT trigger auth
	rbacPayload := `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"secrets is forbidden: User \"dev-user\" cannot list resource \"secrets\" in API group \"\" at the cluster scope","reason":"Forbidden","code":403}`
	rbacResp := &http.Response{
		StatusCode: http.StatusForbidden,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(rbacPayload)),
	}
	v1 := ClassifyHTTPResponse(rbacResp, true)
	if v1.RequiresAuth {
		t.Fatalf("expected RBAC 403 to NOT require auth, got %+v", v1)
	}
	// Ensure body is still fully readable by downstream caller!
	restoredBody, _ := io.ReadAll(rbacResp.Body)
	if string(restoredBody) != rbacPayload {
		t.Fatalf("body corrupted after inspection: got %q", string(restoredBody))
	}

	// 2. Teleport lock / revoked session 403 -> MUST trigger auth
	lockPayload := `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"lock targeting user \"dev-user\" is active","reason":"Forbidden","code":403}`
	lockResp := &http.Response{
		StatusCode: http.StatusForbidden,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(lockPayload)),
	}
	v2 := ClassifyHTTPResponse(lockResp, true)
	if !v2.RequiresAuth {
		t.Fatalf("expected Teleport lock 403 to require auth, got %+v", v2)
	}

	// 3. Teleport plain-text access denied 403 -> MUST trigger auth
	plainResp := &http.Response{
		StatusCode: http.StatusForbidden,
		Header:     http.Header{"Content-Type": []string{"text/plain; charset=utf-8"}},
		Body:       io.NopCloser(strings.NewReader("access denied\n")),
	}
	v3 := ClassifyHTTPResponse(plainResp, true)
	if !v3.RequiresAuth {
		t.Fatalf("expected Teleport plain-text 403 to require auth, got %+v", v3)
	}

	// 4. HTTP 401 -> MUST trigger auth
	unauthResp := &http.Response{
		StatusCode: http.StatusUnauthorized,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"kind":"Status","code":401}`)),
	}
	v4 := ClassifyHTTPResponse(unauthResp, false)
	if !v4.RequiresAuth {
		t.Fatalf("expected 401 to require auth, got %+v", v4)
	}
}

func TestReverseProxyEndToEnd_AuthFlowStreamingAndReloginReset(t *testing.T) {
	var sessionValid atomic.Bool
	sessionValid.Store(false)

	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify proxy stripped loopback token and supplied upstream token
		if got := r.Header.Get("Authorization"); got != "Bearer upstream-valid-token" && sessionValid.Load() {
			t.Logf("upstream saw unexpected Authorization header: %q", got)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !sessionValid.Load() {
			// Simulate Teleport proxy revoking session with 403 access denied
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("access denied: session has expired"))
			return
		}

		if r.URL.Path == "/api/v1/namespaces/default/pods/demo/exec" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			hj, ok := w.(http.Hijacker)
			if !ok {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			conn, rw, err := hj.Hijack()
			if err != nil {
				return
			}
			defer conn.Close()
			_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
			_ = rw.Flush()
			buf := make([]byte, 64)
			n, _ := rw.Read(buf)
			if n > 0 {
				_, _ = rw.WriteString("echo:" + string(buf[:n]))
				_ = rw.Flush()
			}
			return
		}

		if r.URL.Path == "/api/v1/pods" && r.URL.Query().Get("watch") == "true" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			flusher := w.(http.Flusher)
			for i := 0; i < 3; i++ {
				_, _ = fmt.Fprintf(w, "{\"type\":\"ADDED\",\"index\":%d}\n", i)
				flusher.Flush()
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"gitVersion":"v1.31.0"}`))
	}))
	defer upstream.Close()

	// Write a test kubeconfig referencing a Teleport context pointing to `upstream.URL`
	tmpDir := t.TempDir()
	kcPath := filepath.Join(tmpDir, "config")
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["tp-cluster"] = &clientcmdapi.Cluster{
		Server:                upstream.URL,
		InsecureSkipTLSVerify: true,
	}
	cfg.AuthInfos["tp-user"] = &clientcmdapi.AuthInfo{
		Token:             "upstream-valid-token",
		ClientCertificate: "/fake/home/.tsh/keys/example.test/user-kube/example.test/k8s-x509.pem",
	}
	// Clear ClientCertificate after detection test? No, BuildRestConfig will try to load ClientCertificate if set!
	// Let's use Exec or clean token + Teleport server annotation. Actually let's check: if ClientCertificate doesn't exist,
	// rest.TransportFor would fail. Let's test with a valid token and mark Teleport via CA/Exec or let's write a tiny mock!
	cfg.AuthInfos["tp-user"].ClientCertificate = ""
	cfg.Contexts["example.test-cluster"] = &clientcmdapi.Context{
		Cluster:  "tp-cluster",
		AuthInfo: "tp-user",
	}
	cfg.CurrentContext = "example.test-cluster"
	if err := clientcmd.WriteToFile(*cfg, kcPath); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	reg, err := kubeconfig.LoadRegistry([]string{kcPath})
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	// Mark entry as Teleport for test (before NewServer, or update registry)
	entry := reg.Entries["example.test-cluster"]
	entry.Teleport = kubeconfig.TeleportMetadata{
		IsTeleport:      true,
		ProxyAddr:       "example.test:443",
		TeleportCluster: "example.test",
		KubeCluster:     "k8s",
	}
	reg.Entries["example.test-cluster"] = entry

	var ipcBuf safeBuffer
	ipcChan := ipc.NewChannel(&ipcBuf)
	srv := NewServer(reg, "loopback-secret-123", ipcChan)
	proxyTS := httptest.NewServer(srv)
	defer proxyTS.Close()

	// 1. Anonymous Radar endpoint reachability probe (no Authorization header) -> must get 401 cleanly without emitting auth:required
	anonResp, err := http.Get(proxyTS.URL + "/clusters/example.test-cluster/version")
	if err != nil {
		t.Fatalf("anon probe failed: %v", err)
	}
	_ = anonResp.Body.Close()
	if anonResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for anonymous reachability probe, got %d", anonResp.StatusCode)
	}
	if strings.Contains(ipcBuf.String(), `"auth:required"`) {
		t.Fatalf("anonymous reachability probe must NOT emit auth:required")
	}

	// 2. Authenticated Radar request while Teleport session is invalid -> must normalize Teleport 403 to 401 and emit auth:required once
	req1, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/example.test-cluster/version", nil)
	req1.Header.Set("Authorization", "Bearer loopback-secret-123")
	resp1, err := http.DefaultClient.Do(req1)
	if err != nil {
		t.Fatalf("req1 failed: %v", err)
	}
	_ = resp1.Body.Close()
	if resp1.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected normalized 401 towards Radar on Teleport session expiry, got %d", resp1.StatusCode)
	}

	// Second concurrent request while authPending is true -> must NOT emit duplicate auth:required
	req2, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/example.test-cluster/version", nil)
	req2.Header.Set("Authorization", "Bearer loopback-secret-123")
	resp2, _ := http.DefaultClient.Do(req2)
	_ = resp2.Body.Close()

	authCount := countAuthEvents(ipcBuf.String())
	if authCount != 1 {
		t.Fatalf("expected exactly 1 deduplicated auth:required IPC event, got %d; raw=%s", authCount, ipcBuf.String())
	}

	// 3. Simulate successful Teleport login + `auth:completed` command
	sessionValid.Store(true)
	srv.MarkAuthCompleted("example.test-cluster")

	// 4. Verify immediate WATCH streaming works through proxy
	watchReq, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/example.test-cluster/api/v1/pods?watch=true", nil)
	watchReq.Header.Set("Authorization", "Bearer loopback-secret-123")
	watchResp, err := http.DefaultClient.Do(watchReq)
	if err != nil {
		t.Fatalf("watch req failed: %v", err)
	}
	defer watchResp.Body.Close()
	if watchResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on watch stream, got %d", watchResp.StatusCode)
	}
	scanner := bufio.NewScanner(watchResp.Body)
	lines := 0
	for scanner.Scan() {
		lines++
	}
	if lines != 3 {
		t.Fatalf("expected 3 streamed watch events, got %d", lines)
	}

	// 4b. Verify HTTP 101 Upgrade tunneling (used by Kubernetes SPDY / WebSocket exec & portforward)
	proxyAddr := strings.TrimPrefix(proxyTS.URL, "http://")
	rawConn, err := net.DialTimeout("tcp", proxyAddr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial proxy for upgrade test: %v", err)
	}
	defer rawConn.Close()
	upgradeHTTP := "GET /clusters/example.test-cluster/api/v1/namespaces/default/pods/demo/exec HTTP/1.1\r\n" +
		"Host: " + proxyAddr + "\r\n" +
		"Authorization: Bearer loopback-secret-123\r\n" +
		"Connection: Upgrade\r\n" +
		"Upgrade: websocket\r\n\r\n"
	_, _ = rawConn.Write([]byte(upgradeHTTP))
	connReader := bufio.NewReader(rawConn)
	statusLine, err := connReader.ReadString('\n')
	if err != nil || !strings.Contains(statusLine, "101") {
		t.Fatalf("expected 101 Switching Protocols, got %q (err=%v)", statusLine, err)
	}
	// Consume headers until blank line
	for {
		hdr, readErr := connReader.ReadString('\n')
		if readErr != nil || hdr == "\r\n" {
			break
		}
	}
	_, _ = rawConn.Write([]byte("ping-stream"))
	replyBuf := make([]byte, 32)
	nRead, err := connReader.Read(replyBuf)
	if err != nil || string(replyBuf[:nRead]) != "echo:ping-stream" {
		t.Fatalf("expected bidirectional upgraded payload 'echo:ping-stream', got %q (err=%v)", string(replyBuf[:nRead]), err)
	}

	// 5. Simulate mid-session server-side revocation -> must emit a fresh auth:required event!
	sessionValid.Store(false)
	time.Sleep(10 * time.Millisecond)
	reqRevoked, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/example.test-cluster/version", nil)
	reqRevoked.Header.Set("Authorization", "Bearer loopback-secret-123")
	respRevoked, err := http.DefaultClient.Do(reqRevoked)
	if err != nil {
		t.Fatalf("revoked req failed: %v", err)
	}
	_ = respRevoked.Body.Close()
	if respRevoked.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 on mid-session revocation, got %d", respRevoked.StatusCode)
	}
	if got := countAuthEvents(ipcBuf.String()); got != 2 {
		t.Fatalf("expected 2 total auth:required events after re-revocation, got %d", got)
	}
}

func TestActiveContextEventDeduped(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	tmpDir := t.TempDir()
	kcPath := filepath.Join(tmpDir, "config")
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["c1"] = &clientcmdapi.Cluster{Server: upstream.URL}
	cfg.Clusters["c2"] = &clientcmdapi.Cluster{Server: upstream.URL}
	cfg.AuthInfos["u"] = &clientcmdapi.AuthInfo{Token: "tok"}
	cfg.Contexts["ctx-alpha"] = &clientcmdapi.Context{Cluster: "c1", AuthInfo: "u"}
	cfg.Contexts["ctx-beta"] = &clientcmdapi.Context{Cluster: "c2", AuthInfo: "u"}
	cfg.CurrentContext = "ctx-alpha"
	if err := clientcmd.WriteToFile(*cfg, kcPath); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	reg, err := kubeconfig.LoadRegistry([]string{kcPath})
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}

	var ipcBuf safeBuffer
	srv := NewServer(reg, "tok-secret", ipc.NewChannel(&ipcBuf))
	proxyTS := httptest.NewServer(srv)
	defer proxyTS.Close()

	sendReq := func(ctxName string) {
		req, _ := http.NewRequest(http.MethodGet, proxyTS.URL+"/clusters/"+ctxName+"/version", nil)
		req.Header.Set("Authorization", "Bearer tok-secret")
		resp, doErr := http.DefaultClient.Do(req)
		if doErr != nil {
			t.Fatalf("request failed: %v", doErr)
		}
		_ = resp.Body.Close()
	}

	// Multiple requests to ctx-alpha -> only 1 active_context event
	sendReq("ctx-alpha")
	sendReq("ctx-alpha")
	sendReq("ctx-beta")
	sendReq("ctx-beta")

	var activeEvents []string
	for _, line := range strings.Split(strings.TrimSpace(ipcBuf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(line), &m) == nil && m["type"] == "proxy:active_context" {
			if c, ok := m["context"].(string); ok {
				activeEvents = append(activeEvents, c)
			}
		}
	}

	if len(activeEvents) != 2 || activeEvents[0] != "ctx-alpha" || activeEvents[1] != "ctx-beta" {
		t.Fatalf("expected activeEvents [ctx-alpha ctx-beta], got %v", activeEvents)
	}
}

type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *safeBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *safeBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func countAuthEvents(ndjson string) int {
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(ndjson), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(line), &m) == nil && m["type"] == "auth:required" {
			count++
		}
	}
	return count
}
