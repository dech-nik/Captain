package proxy

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"sync"
	"time"
)

// LoopbackTLS holds an ephemeral in-memory self-signed localhost TLS certificate
// generated at proxy startup so `client-go` inside Radar willingly sends Bearer tokens
// over `https://127.0.0.1:<port>` (client-go strips Bearer tokens on plaintext `http://`).
type LoopbackTLS struct {
	CertPEM   []byte
	TLSConfig *tls.Config
}

var (
	cachedLoopbackTLSOnce sync.Once
	cachedLoopbackTLS     *LoopbackTLS
	cachedLoopbackTLSErr  error
)

func GenerateLoopbackTLS() (*LoopbackTLS, error) {
	cachedLoopbackTLSOnce.Do(func() {
		priv, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			cachedLoopbackTLSErr = fmt.Errorf("generate loopback RSA key: %w", err)
			return
		}

		serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
		serialNumber, err := rand.Int(rand.Reader, serialLimit)
		if err != nil {
			cachedLoopbackTLSErr = fmt.Errorf("generate serial: %w", err)
			return
		}

		now := time.Now()
		tmpl := x509.Certificate{
			SerialNumber: serialNumber,
			Subject: pkix.Name{
				CommonName:   "127.0.0.1",
				Organization: []string{"Captain Local Proxy"},
			},
			NotBefore:             now.Add(-5 * time.Minute),
			NotAfter:              now.Add(365 * 24 * time.Hour),
			KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
			ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
			BasicConstraintsValid: true,
			IsCA:                  true,
			IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
			DNSNames:              []string{"localhost"},
		}

		derBytes, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
		if err != nil {
			cachedLoopbackTLSErr = fmt.Errorf("create loopback cert: %w", err)
			return
		}

		var certBuf, keyBuf bytes.Buffer
		_ = pem.Encode(&certBuf, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
		_ = pem.Encode(&keyBuf, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})

		tlsCert, err := tls.X509KeyPair(certBuf.Bytes(), keyBuf.Bytes())
		if err != nil {
			cachedLoopbackTLSErr = fmt.Errorf("parse loopback keypair: %w", err)
			return
		}

		cachedLoopbackTLS = &LoopbackTLS{
			CertPEM: certBuf.Bytes(),
			TLSConfig: &tls.Config{
				MinVersion:   tls.VersionTLS12,
				Certificates: []tls.Certificate{tlsCert},
			},
		}
	})
	return cachedLoopbackTLS, cachedLoopbackTLSErr
}

func constantTimeEquals(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
