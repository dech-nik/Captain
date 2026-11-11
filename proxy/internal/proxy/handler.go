package proxy

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/rest"
	"captain/proxy/internal/ipc"
	"captain/proxy/internal/kubeconfig"
)

type contextUpstream struct {
	targetURL    *url.URL
	transport    http.RoundTripper
	reverseProxy *httputil.ReverseProxy
	entry        kubeconfig.ContextEntry
}

type closeIdler interface {
	CloseIdleConnections()
}

// Server routes local requests from Radar (`/clusters/<encoded-context>/...`) to the real upstream
// Kubernetes / Teleport endpoint using client-go's `rest.TransportFor`.
type Server struct {
	loopbackToken string
	ipcChan       *ipc.Channel

	mu        sync.RWMutex
	registry  *kubeconfig.Registry
	upstreams map[string]*contextUpstream

	authMu       sync.Mutex
	authPending  map[string]bool      // Keyed by authKey(entry) so one login covers shared Teleport cluster
	lastEmitted  map[string]time.Time // Debounce guard against parallel informer storms
	diagCooldown map[string]time.Time

	// knownTeleport remembers Teleport contexts seen while a session existed.
	// sessionLost marks contexts removed by `tsh logout` that we still serve locally.
	knownTeleport map[string]kubeconfig.ContextEntry
	sessionLost   map[string]bool
}

func NewServer(reg *kubeconfig.Registry, loopbackToken string, ipcChan *ipc.Channel) *Server {
	return &Server{
		loopbackToken: loopbackToken,
		ipcChan:       ipcChan,
		registry:      reg,
		upstreams:     make(map[string]*contextUpstream),
		authPending:   make(map[string]bool),
		lastEmitted:   make(map[string]time.Time),
		diagCooldown:  make(map[string]time.Time),
		knownTeleport: make(map[string]kubeconfig.ContextEntry),
		sessionLost:   make(map[string]bool),
	}
}

// UpdateRegistry swaps the active kubeconfig registry and evicts cached transports so updated configs apply cleanly.
func (s *Server) UpdateRegistry(reg *kubeconfig.Registry) {
	s.mu.Lock()
	old := s.upstreams
	s.registry = reg
	s.upstreams = make(map[string]*contextUpstream)
	s.mu.Unlock()

	for _, u := range old {
		closeTransportConnections(u.transport)
	}
}

// MarkAuthCompleted clears the pending-auth gate and closes all pooled HTTP/1.1 & HTTP/2 connections
// so subsequent requests perform a fresh TLS/mTLS handshake and re-read updated Teleport credentials.
func (s *Server) MarkAuthCompleted(contextName string) {
	s.mu.Lock()
	var toClose []http.RoundTripper
	if contextName == "" {
		for k, u := range s.upstreams {
			toClose = append(toClose, u.transport)
			delete(s.upstreams, k)
		}
	} else {
		// Evict both the named context and any sibling contexts sharing the same Teleport proxy/cluster
		var targetClusterKey string
		if entry, ok := s.registry.Entries[contextName]; ok {
			targetClusterKey = authDedupeKey(entry)
		}
		for k, u := range s.upstreams {
			if k == contextName || (targetClusterKey != "" && authDedupeKey(u.entry) == targetClusterKey) {
				toClose = append(toClose, u.transport)
				delete(s.upstreams, k)
			}
		}
	}
	s.mu.Unlock()

	for _, rt := range toClose {
		closeTransportConnections(rt)
	}

	s.authMu.Lock()
	if contextName == "" {
		s.authPending = make(map[string]bool)
		s.lastEmitted = make(map[string]time.Time)
	} else {
		s.mu.RLock()
		entry, ok := s.registry.Entries[contextName]
		s.mu.RUnlock()
		key := contextName
		if ok {
			key = authDedupeKey(entry)
		}
		delete(s.authPending, key)
		delete(s.lastEmitted, key)
	}
	s.authMu.Unlock()
}

// MarkAuthCancelled releases the pending lock so future requests can trigger login again if needed.
func (s *Server) MarkAuthCancelled(contextName string) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if contextName == "" {
		s.authPending = make(map[string]bool)
		return
	}
	s.mu.RLock()
	entry, ok := s.registry.Entries[contextName]
	s.mu.RUnlock()
	key := contextName
	if ok {
		key = authDedupeKey(entry)
	}
	delete(s.authPending, key)
	// Keep a brief cooldown so background retries don't re-pop the dialog within the same millisecond
	s.lastEmitted[key] = time.Now()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}

	ctxName, subPath, ok := parseClusterRoute(r.URL.Path)
	if !ok {
		writeK8sStatus(w, http.StatusNotFound, "NotFound", "unknown proxy route")
		return
	}

	// Verify loopback bearer token.
	// IMPORTANT COMPATIBILITY WITH RADAR:
	// When Radar observes an HTTP 401, its `defaultRuntimeAuthEndpointProbe` sends an anonymous
	// credential-free `GET <server>/version` to verify the endpoint is reachable (separating credential
	// expiry from laptop offline). Returning HTTP 401 directly here tells Radar the endpoint IS reachable
	// so Radar cleanly transitions to `auth-rejected` without false "offline" inconclusive loops!
	if !s.hasValidLoopbackToken(r) {
		writeK8sStatus(w, http.StatusUnauthorized, "Unauthorized", "authentication required")
		return
	}

	if ctxName == kubeconfig.PlaceholderContextName {
		writeK8sStatus(w, http.StatusUnauthorized, "Unauthorized", "no Kubernetes context configured yet; login to Teleport to load clusters")
		return
	}

	// A context removed by `tsh logout` is still routed here. Answer 401 (reachable, unauthorized)
	// instead of dropping the context or returning 502, which Radar would show as offline.
	if lost, ok := s.loggedOutTeleport(ctxName); ok {
		s.notifyAuthRequired(lost, loggedOutAuthReason, http.StatusUnauthorized)
		writeK8sStatus(w, http.StatusUnauthorized, "Unauthorized", loggedOutAuthReason)
		return
	}

	upstream, err := s.getOrCreateUpstream(ctxName)
	if err != nil {
		if entry, ok := s.lookupEntry(ctxName); ok && entry.Teleport.IsTeleport {
			verdict := ClassifyTransportError(err)
			if verdict.RequiresAuth {
				s.notifyAuthRequired(entry, verdict.Reason, http.StatusUnauthorized)
				writeK8sStatus(w, http.StatusUnauthorized, "Unauthorized", verdict.Reason)
				return
			}
		}
		cleanErr := scrubLogText(err.Error())
		log.Printf("[k8s-proxy] failed to initialize upstream for context: %s", cleanErr)
		writePlainUpstreamError(w, http.StatusBadGateway, cleanErr)
		return
	}

	// Strip the synthetic loopback Authorization header so client-go's RoundTripper (or mTLS cert)
	// supplies the real upstream credentials without header conflicts.
	outReq := r.Clone(r.Context())
	outReq.Header.Del("Authorization")
	outReq.URL.Path = subPath
	outReq.URL.RawPath = ""

	upstream.reverseProxy.ServeHTTP(w, outReq)
}

func (s *Server) hasValidLoopbackToken(r *http.Request) bool {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return false
	}
	got := strings.TrimPrefix(authHeader, prefix)
	return subtle.ConstantTimeCompare([]byte(got), []byte(s.loopbackToken)) == 1
}

func (s *Server) getOrCreateUpstream(ctxName string) (*contextUpstream, error) {
	s.mu.RLock()
	existing, ok := s.upstreams[ctxName]
	s.mu.RUnlock()
	if ok {
		return existing, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.upstreams[ctxName]; ok {
		return existing, nil
	}

	entry, exists := s.registry.Entries[ctxName]
	if !exists {
		return nil, fmt.Errorf("context not found in registry")
	}

	restCfg, err := kubeconfig.BuildRestConfig(entry)
	if err != nil {
		return nil, err
	}

	targetURL, err := parseServerURL(restCfg.Host)
	if err != nil {
		return nil, err
	}

	transport, err := rest.TransportFor(restCfg)
	if err != nil {
		return nil, fmt.Errorf("rest.TransportFor failed: %w", err)
	}

	cu := &contextUpstream{
		targetURL: targetURL,
		transport: transport,
		entry:     entry,
	}

	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(targetURL)
			pr.Out.Host = targetURL.Host
			// Join targetURL.Path prefix (if the K8s API is hosted under a subpath) with the incoming subPath
			pr.Out.URL.Path = joinURLPath(targetURL.Path, pr.In.URL.Path)
			pr.Out.URL.RawPath = ""
			// Do not forward X-Forwarded-* headers to kube-apiserver / Teleport unless needed;
			// standard ReverseProxy.Rewrite leaves X-Forwarded-* clean unless SetXForwarded is called.
		},
		Transport:     transport,
		FlushInterval: -1, // Immediate flush for WATCH streams and pod logs
		ModifyResponse: func(resp *http.Response) error {
			verdict := ClassifyHTTPResponse(resp, entry.Teleport.IsTeleport)
			if verdict.RequiresAuth {
				s.emitDiagnostic(ctxName, verdict.Category, resp.StatusCode, verdict.Reason)
				s.notifyAuthRequired(entry, verdict.Reason, resp.StatusCode)
				// Normalize Teleport 403 session revocations to HTTP 401 towards Radar so Radar's
				// `runtimeAuthRoundTripper` immediately recognizes credential loss (Radar intentionally
				// ignores 403 assuming RBAC, whereas 401 triggers clean auth-rejected state).
				if resp.StatusCode == http.StatusForbidden {
					replaceResponseWith401Status(resp, verdict.Reason)
				}
			} else if resp.StatusCode == http.StatusForbidden {
				s.emitDiagnostic(ctxName, verdict.Category, resp.StatusCode, "Kubernetes RBAC forbidden (ignored for re-auth)")
			}
			return nil
		},
		ErrorHandler: func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
			verdict := ClassifyTransportError(proxyErr)
			if verdict.RequiresAuth {
				s.emitDiagnostic(ctxName, verdict.Category, http.StatusUnauthorized, verdict.Reason)
				s.notifyAuthRequired(entry, verdict.Reason, http.StatusUnauthorized)
				writeK8sStatus(rw, http.StatusUnauthorized, "Unauthorized", verdict.Reason)
				return
			}
			// Do not log noisy context canceled errors from normal client stream disconnects
			if req.Context().Err() != nil {
				return
			}
			// Logout can surface as a dial failure on an in-flight request. That would look like
			// an offline cluster (502 / connection refused). A known logged-out Teleport context
			// is authentication loss, so Radar must see HTTP 401 instead.
			if lost, ok := s.loggedOutTeleport(ctxName); ok {
				s.emitDiagnostic(ctxName, "teleport-logout", http.StatusUnauthorized, loggedOutAuthReason)
				s.notifyAuthRequired(lost, loggedOutAuthReason, http.StatusUnauthorized)
				writeK8sStatus(rw, http.StatusUnauthorized, "Unauthorized", loggedOutAuthReason)
				return
			}
			cleanErr := scrubLogText(proxyErr.Error())
			s.emitDiagnostic(ctxName, "transport-error", http.StatusBadGateway, cleanErr)
			// CRITICAL FOR RADAR / CLIENT-GO:
			// Radar's `TestClusterConnection` calls `RESTClient().Get().AbsPath("/version").Do(ctx).Raw()`.
			// In client-go, `.Raw()` only preserves the error text on 5xx responses when `Content-Type` is
			// `text/plain` (otherwise client-go replaces JSON bodies on 502 with `"unknown"`!).
			// Writing `text/plain` lets Radar display the true network error (e.g. `connection refused` on a stopped kind cluster)
			// and classify it accurately as `"network"` instead of `"unknown"`.
			writePlainUpstreamError(rw, http.StatusBadGateway, cleanErr)
		},
	}

	cu.reverseProxy = rp
	s.upstreams[ctxName] = cu
	return cu, nil
}

func (s *Server) notifyAuthRequired(entry kubeconfig.ContextEntry, reason string, statusCode int) {
	if s.ipcChan == nil {
		return
	}
	key := authDedupeKey(entry)

	s.authMu.Lock()
	if s.authPending[key] {
		s.authMu.Unlock()
		return
	}
	if last, ok := s.lastEmitted[key]; ok && time.Since(last) < 3*time.Second {
		s.authMu.Unlock()
		return
	}
	s.authPending[key] = true
	s.lastEmitted[key] = time.Now()
	s.authMu.Unlock()

	_ = s.ipcChan.Send(ipc.AuthRequiredEvent{
		Type:       "auth:required",
		Context:    entry.QualifiedName,
		Reason:     reason,
		StatusCode: statusCode,
		Teleport:   entry.Teleport,
	})
}

func (s *Server) emitDiagnostic(ctxName, category string, statusCode int, detail string) {
	if s.ipcChan == nil {
		return
	}
	key := fmt.Sprintf("%s:%s:%d", ctxName, category, statusCode)
	s.authMu.Lock()
	if last, ok := s.diagCooldown[key]; ok && time.Since(last) < 5*time.Second {
		s.authMu.Unlock()
		return
	}
	s.diagCooldown[key] = time.Now()
	s.authMu.Unlock()

	_ = s.ipcChan.Send(ipc.DiagnosticEvent{
		Type:       "proxy:diagnostic",
		Context:    ctxName,
		Category:   category,
		StatusCode: statusCode,
		Detail:     detail,
	})
}

func authDedupeKey(entry kubeconfig.ContextEntry) string {
	if entry.Teleport.IsTeleport && entry.Teleport.ProxyAddr != "" {
		return "teleport:" + entry.Teleport.ProxyAddr + ":" + entry.Teleport.TeleportCluster
	}
	return "ctx:" + entry.QualifiedName
}

func parseClusterRoute(rawPath string) (ctxName string, subPath string, ok bool) {
	const prefix = "/clusters/"
	if !strings.HasPrefix(rawPath, prefix) {
		return "", "", false
	}
	restPath := strings.TrimPrefix(rawPath, prefix)
	if restPath == "" {
		return "", "", false
	}
	var encodedCtx string
	slashIdx := strings.IndexByte(restPath, '/')
	if slashIdx == -1 {
		encodedCtx = restPath
		subPath = "/"
	} else {
		encodedCtx = restPath[:slashIdx]
		subPath = restPath[slashIdx:]
	}
	decoded, err := url.PathUnescape(encodedCtx)
	if err != nil || decoded == "" {
		return "", "", false
	}
	return decoded, subPath, true
}

func parseServerURL(host string) (*url.URL, error) {
	raw := strings.TrimSpace(host)
	if raw == "" {
		return nil, fmt.Errorf("empty Kubernetes server host")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid Kubernetes server URL")
	}
	return u, nil
}

func joinURLPath(basePath, reqPath string) string {
	if basePath == "" || basePath == "/" {
		if reqPath == "" {
			return "/"
		}
		return reqPath
	}
	cleanBase := strings.TrimRight(basePath, "/")
	if reqPath == "" || reqPath == "/" {
		return cleanBase + "/"
	}
	return path.Clean(cleanBase + "/" + strings.TrimLeft(reqPath, "/"))
}

func writePlainUpstreamError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(message))
}

func writeK8sStatus(w http.ResponseWriter, code int, reason, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"apiVersion": "v1",
		"kind":       "Status",
		"status":     "Failure",
		"message":    message,
		"reason":     reason,
		"code":       code,
	})
}

func replaceResponseWith401Status(resp *http.Response, message string) {
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	payload, _ := json.Marshal(map[string]any{
		"apiVersion": "v1",
		"kind":       "Status",
		"status":     "Failure",
		"message":    message,
		"reason":     "Unauthorized",
		"code":       http.StatusUnauthorized,
	})
	resp.StatusCode = http.StatusUnauthorized
	resp.Status = "401 Unauthorized"
	resp.Header.Set("Content-Type", "application/json")
	resp.Header.Del("Content-Length")
	resp.ContentLength = int64(len(payload))
	resp.Body = io.NopCloser(bytes.NewReader(payload))
}

func closeTransportConnections(rt http.RoundTripper) {
	if rt == nil {
		return
	}
	if ci, ok := rt.(closeIdler); ok {
		ci.CloseIdleConnections()
	}
}

func scrubLogText(s string) string {
	// Keep logs compact and avoid dumping raw tokens or PEM blocks
	if idx := strings.Index(strings.ToLower(s), "bearer "); idx != -1 {
		return s[:idx] + "Bearer [REDACTED]"
	}
	if len(s) > 240 {
		return s[:240] + "..."
	}
	return s
}
