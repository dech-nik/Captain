package kubeconfig

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	syntheticUserName      = "captain-proxy"
	PlaceholderContextName = "teleport-login-pending"
)

// WriteSyntheticKubeconfig writes an isolated kubeconfig file (mode 0600) whose contexts,
// cluster names, and default namespaces mirror the user's real Registry, while pointing every
// cluster server URL at the local Go HTTPS reverse proxy (`https://127.0.0.1:<port>`) with the
// ephemeral loopback CA and session-scoped bearer token.
func WriteSyntheticKubeconfig(destPath string, reg *Registry, proxyPort int, loopbackToken string, caCertPEM []byte) error {
	cfg := clientcmdapi.NewConfig()
	cfg.AuthInfos[syntheticUserName] = &clientcmdapi.AuthInfo{
		Token: loopbackToken,
	}

	scheme := "http"
	if len(caCertPEM) > 0 {
		scheme = "https"
	}

	if len(reg.OrderedNames) == 0 {
		serverURL := fmt.Sprintf("%s://127.0.0.1:%d/clusters/%s", scheme, proxyPort, PlaceholderContextName)
		cfg.Clusters[PlaceholderContextName] = &clientcmdapi.Cluster{
			Server:                   serverURL,
			CertificateAuthorityData: caCertPEM,
		}
		cfg.Contexts[PlaceholderContextName] = &clientcmdapi.Context{
			Cluster:  PlaceholderContextName,
			AuthInfo: syntheticUserName,
		}
		cfg.CurrentContext = PlaceholderContextName
	} else {
		for _, name := range reg.OrderedNames {
			entry := reg.Entries[name]
			encodedCtx := url.PathEscape(name)
			serverURL := fmt.Sprintf("%s://127.0.0.1:%d/clusters/%s", scheme, proxyPort, encodedCtx)

			// Each context gets its own cluster entry keyed by qualified name so distinct contexts
			// that originally shared a cluster name still route to distinct proxy URLs.
			clusterKey := name
			cfg.Clusters[clusterKey] = &clientcmdapi.Cluster{
				Server:                   serverURL,
				CertificateAuthorityData: caCertPEM,
			}
			cfg.Contexts[name] = &clientcmdapi.Context{
				Cluster:   clusterKey,
				AuthInfo:  syntheticUserName,
				Namespace: entry.Namespace,
			}
		}
		cfg.CurrentContext = reg.CurrentContext
	}

	if err := os.MkdirAll(filepath.Dir(destPath), 0700); err != nil {
		return fmt.Errorf("create synthetic kubeconfig dir: %w", err)
	}

	tmpPath := destPath + ".tmp"
	if err := clientcmd.WriteToFile(*cfg, tmpPath); err != nil {
		return fmt.Errorf("write synthetic kubeconfig: %w", err)
	}
	if err := os.Chmod(tmpPath, 0600); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("chmod synthetic kubeconfig: %w", err)
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename synthetic kubeconfig: %w", err)
	}
	return nil
}
