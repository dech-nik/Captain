package kubeconfig

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/util/homedir"
)

// TeleportMetadata carries generic Teleport connection hints extracted from a kubeconfig context.
// Nothing is hardcoded; all fields are inferred structurally from exec args, cert paths, or URLs.
type TeleportMetadata struct {
	IsTeleport      bool   `json:"isTeleport"`
	ProxyAddr       string `json:"proxyAddr,omitempty"`
	TeleportCluster string `json:"teleportCluster,omitempty"`
	KubeCluster     string `json:"kubeCluster,omitempty"`
}

// ContextSummary is the serializable overview sent via IPC to Electron.
type ContextSummary struct {
	Name      string           `json:"name"`
	Cluster   string           `json:"cluster"`
	Namespace string           `json:"namespace,omitempty"`
	Teleport  TeleportMetadata `json:"teleport"`
}

// ContextEntry represents an isolated kubeconfig context mapped to its source file.
type ContextEntry struct {
	QualifiedName string
	InFileName    string
	SourceFile    string
	ClusterName   string
	Namespace     string
	ServerURL     string
	Teleport      TeleportMetadata
	RawConfig     *clientcmdapi.Config
}

// Registry holds all resolved contexts from the user's kubeconfig sources.
type Registry struct {
	Entries        map[string]ContextEntry
	OrderedNames   []string
	CurrentContext string
	WatchedPaths   []string
}

// ResolveSourcePaths resolves kubeconfig paths from explicit overrides, KUBECONFIG env, or ~/.kube/config.
func ResolveSourcePaths(explicit string, kubeconfigEnv string) []string {
	var candidates []string
	if strings.TrimSpace(explicit) != "" {
		candidates = filepath.SplitList(explicit)
	} else if strings.TrimSpace(kubeconfigEnv) != "" {
		candidates = filepath.SplitList(kubeconfigEnv)
	} else if home := homedir.HomeDir(); home != "" {
		candidates = []string{filepath.Join(home, ".kube", "config")}
	}

	seen := make(map[string]struct{}, len(candidates))
	var out []string
	for _, p := range candidates {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err == nil {
			p = abs
		}
		if _, exists := seen[p]; exists {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

// LoadRegistry loads each kubeconfig file in isolation (avoiding cross-file name collisions)
// and extracts Teleport metadata generically.
func LoadRegistry(paths []string) (*Registry, error) {
	entries := make(map[string]ContextEntry)
	var ordered []string
	var currentCtx string

	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		cfg, err := clientcmd.LoadFromFile(path)
		if err != nil {
			continue
		}

		ctxNames := make([]string, 0, len(cfg.Contexts))
		for name := range cfg.Contexts {
			ctxNames = append(ctxNames, name)
		}
		sort.Strings(ctxNames)

		for _, inFileName := range ctxNames {
			ctxObj := cfg.Contexts[inFileName]
			if ctxObj == nil {
				continue
			}
			clusterObj := cfg.Clusters[ctxObj.Cluster]
			authObj := cfg.AuthInfos[ctxObj.AuthInfo]
			if clusterObj == nil {
				continue
			}

			qName := qualifyContextName(entries, inFileName, path)
			tpMeta := detectTeleportMetadata(inFileName, ctxObj, clusterObj, authObj)

			entry := ContextEntry{
				QualifiedName: qName,
				InFileName:    inFileName,
				SourceFile:    path,
				ClusterName:   ctxObj.Cluster,
				Namespace:     ctxObj.Namespace,
				ServerURL:     clusterObj.Server,
				Teleport:      tpMeta,
				RawConfig:     cfg.DeepCopy(),
			}
			entries[qName] = entry
			ordered = append(ordered, qName)

			if currentCtx == "" && cfg.CurrentContext == inFileName {
				currentCtx = qName
			}
		}
	}

	if currentCtx == "" && len(ordered) > 0 {
		currentCtx = ordered[0]
	}

	return &Registry{
		Entries:        entries,
		OrderedNames:   ordered,
		CurrentContext: currentCtx,
		WatchedPaths:   paths,
	}, nil
}

// Summaries returns the ordered list of ContextSummary objects for IPC.
func (r *Registry) Summaries() []ContextSummary {
	out := make([]ContextSummary, 0, len(r.OrderedNames))
	for _, name := range r.OrderedNames {
		e := r.Entries[name]
		out = append(out, ContextSummary{
			Name:      e.QualifiedName,
			Cluster:   e.ClusterName,
			Namespace: e.Namespace,
			Teleport:  e.Teleport,
		})
	}
	return out
}

// BuildRestConfig builds a fresh *rest.Config for a specific context entry from disk
// (so refreshed certs/keys on disk are always picked up) and enforces non-interactive exec mode.
func BuildRestConfig(entry ContextEntry) (*rest.Config, error) {
	loadingRules := &clientcmd.ClientConfigLoadingRules{
		ExplicitPath: entry.SourceFile,
	}
	overrides := &clientcmd.ConfigOverrides{
		CurrentContext: entry.InFileName,
	}
	clientCfg := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
	restCfg, err := clientCfg.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("build rest.Config for context %q: %w", entry.QualifiedName, err)
	}

	// CRITICAL: Prevent exec credential plugins (such as `tsh kube credentials`) from ever blocking
	// on interactive stdin or spawning external browser / Teleport Connect windows.
	if restCfg.ExecProvider != nil {
		restCfg.ExecProvider.InteractiveMode = clientcmdapi.NeverExecInteractiveMode
		restCfg.ExecProvider.Env = appendEnvOverride(restCfg.ExecProvider.Env, "BROWSER", "none")
		restCfg.ExecProvider.Env = appendEnvOverride(restCfg.ExecProvider.Env, "TELEPORT_ADD_KEYS_TO_AGENT", "no")
	}

	return restCfg, nil
}

func appendEnvOverride(envs []clientcmdapi.ExecEnvVar, name, value string) []clientcmdapi.ExecEnvVar {
	for i := range envs {
		if envs[i].Name == name {
			envs[i].Value = value
			return envs
		}
	}
	return append(envs, clientcmdapi.ExecEnvVar{Name: name, Value: value})
}

func qualifyContextName(existing map[string]ContextEntry, name, path string) string {
	if _, taken := existing[name]; !taken {
		return name
	}
	label := sourceLabel(path)
	candidate := fmt.Sprintf("%s (%s)", name, label)
	if _, taken := existing[candidate]; !taken {
		return candidate
	}
	for i := 2; ; i++ {
		c := fmt.Sprintf("%s (%s #%d)", name, label, i)
		if _, taken := existing[c]; !taken {
			return c
		}
	}
}

func sourceLabel(path string) string {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if base == "config" || base == "kubeconfig" {
		parent := filepath.Base(filepath.Dir(path))
		if parent != "" && parent != "." && parent != string(filepath.Separator) {
			return strings.TrimPrefix(parent, ".")
		}
	}
	return base
}

// detectTeleportMetadata inspects exec plugins, certificate file paths, extensions, and server URLs
// to determine whether a kubeconfig context belongs to Teleport and extract login parameters.
func detectTeleportMetadata(
	ctxName string,
	ctxObj *clientcmdapi.Context,
	clusterObj *clientcmdapi.Cluster,
	authObj *clientcmdapi.AuthInfo,
) TeleportMetadata {
	var meta TeleportMetadata

	// 1. Check ExecProvider (standard for modern `tsh kube login` kubeconfigs)
	if authObj != nil && authObj.Exec != nil {
		cmdBase := strings.ToLower(filepath.Base(authObj.Exec.Command))
		cmdBase = strings.TrimSuffix(cmdBase, ".exe")
		if cmdBase == "tsh" || strings.HasPrefix(cmdBase, "tsh") {
			meta.IsTeleport = true
		}

		for i := 0; i < len(authObj.Exec.Args); i++ {
			arg := authObj.Exec.Args[i]
			switch {
			case strings.HasPrefix(arg, "--proxy="):
				meta.ProxyAddr = strings.TrimPrefix(arg, "--proxy=")
				meta.IsTeleport = true
			case arg == "--proxy" && i+1 < len(authObj.Exec.Args):
				meta.ProxyAddr = authObj.Exec.Args[i+1]
				meta.IsTeleport = true
				i++
			case strings.HasPrefix(arg, "--teleport-cluster="):
				meta.TeleportCluster = strings.TrimPrefix(arg, "--teleport-cluster=")
				meta.IsTeleport = true
			case arg == "--teleport-cluster" && i+1 < len(authObj.Exec.Args):
				meta.TeleportCluster = authObj.Exec.Args[i+1]
				meta.IsTeleport = true
				i++
			case strings.HasPrefix(arg, "--kube-cluster="):
				meta.KubeCluster = strings.TrimPrefix(arg, "--kube-cluster=")
				meta.IsTeleport = true
			case arg == "--kube-cluster" && i+1 < len(authObj.Exec.Args):
				meta.KubeCluster = authObj.Exec.Args[i+1]
				meta.IsTeleport = true
				i++
			}
		}

		for _, env := range authObj.Exec.Env {
			if env.Name == "TELEPORT_PROXY" && meta.ProxyAddr == "" {
				meta.ProxyAddr = env.Value
				meta.IsTeleport = true
			}
			if env.Name == "TELEPORT_CLUSTER" && meta.TeleportCluster == "" {
				meta.TeleportCluster = env.Value
				meta.IsTeleport = true
			}
		}
	}

	// 2. Check ~/.tsh keys paths in client certificates or CA files (used by `tsh login -f kubernetes` or older profiles)
	var certPaths []string
	if authObj != nil {
		if authObj.ClientCertificate != "" {
			certPaths = append(certPaths, authObj.ClientCertificate)
		}
		if authObj.ClientKey != "" {
			certPaths = append(certPaths, authObj.ClientKey)
		}
	}
	if clusterObj != nil && clusterObj.CertificateAuthority != "" {
		certPaths = append(certPaths, clusterObj.CertificateAuthority)
	}

	for _, p := range certPaths {
		slashed := filepath.ToSlash(p)
		if idx := strings.Index(slashed, "/.tsh/keys/"); idx != -1 {
			meta.IsTeleport = true
			restPath := slashed[idx+len("/.tsh/keys/"):]
			parts := strings.Split(restPath, "/")
			// Typical layout: ~/.tsh/keys/<proxyHost>/<user>-kube/<teleportCluster>/<kubeCluster>-x509.pem
			if len(parts) >= 1 && meta.ProxyAddr == "" && parts[0] != "" {
				meta.ProxyAddr = parts[0]
			}
			if len(parts) >= 3 && meta.TeleportCluster == "" && strings.HasSuffix(parts[1], "-kube") {
				meta.TeleportCluster = parts[2]
			}
		}
	}

	// 3. Fallback: derive proxy host:port from cluster server URL when context is known Teleport
	if meta.IsTeleport && meta.ProxyAddr == "" && clusterObj != nil && clusterObj.Server != "" {
		if u, err := url.Parse(clusterObj.Server); err == nil && u.Host != "" {
			meta.ProxyAddr = u.Host
		}
	}

	// 4. Fallback: derive teleport / kube cluster from conventional `<teleportCluster>-<kubeCluster>` context naming
	if meta.IsTeleport && meta.KubeCluster == "" && meta.TeleportCluster != "" {
		prefix := meta.TeleportCluster + "-"
		if strings.HasPrefix(ctxName, prefix) {
			meta.KubeCluster = strings.TrimPrefix(ctxName, prefix)
		}
	}

	return meta
}
