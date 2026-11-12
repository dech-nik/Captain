package ipc

import (
	"bufio"
	"encoding/json"
	"io"
	"sync"

	"captain/proxy/internal/kubeconfig"
)

// InboundCommand represents a JSON line sent from Electron to the Go proxy over stdin.
type InboundCommand struct {
	Type    string `json:"type"`
	Context string `json:"context,omitempty"`
}

// ReadyEvent announces that the loopback proxy is listening and synthetic kubeconfig is written.
type ReadyEvent struct {
	Type                string                      `json:"type"`
	Port                int                         `json:"port"`
	SyntheticKubeconfig string                      `json:"syntheticKubeconfig"`
	Contexts            []kubeconfig.ContextSummary `json:"contexts"`
	CurrentContext      string                      `json:"currentContext"`
}

// ContextsUpdatedEvent notifies Electron that source kubeconfigs changed on disk.
type ContextsUpdatedEvent struct {
	Type           string                      `json:"type"`
	Contexts       []kubeconfig.ContextSummary `json:"contexts"`
	CurrentContext string                      `json:"currentContext"`
}

// ActiveContextEvent notifies Electron when Radar begins routing traffic to a different context.
type ActiveContextEvent struct {
	Type    string `json:"type"`
	Context string `json:"context"`
}

// AuthRequiredEvent notifies Electron that an upstream request failed due to missing/expired/revoked auth.
type AuthRequiredEvent struct {
	Type       string                      `json:"type"`
	Context    string                      `json:"context"`
	Reason     string                      `json:"reason"`
	StatusCode int                         `json:"statusCode,omitempty"`
	Teleport   kubeconfig.TeleportMetadata `json:"teleport"`
}

// DiagnosticEvent emits scrubbed diagnostic telemetry to Electron without leaking sensitive payloads.
type DiagnosticEvent struct {
	Type       string `json:"type"`
	Context    string `json:"context"`
	Category   string `json:"category"`
	StatusCode int    `json:"statusCode,omitempty"`
	Detail     string `json:"detail"`
}

// Channel provides thread-safe NDJSON emission on stdout and line-based reading from stdin.
type Channel struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func NewChannel(out io.Writer) *Channel {
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	return &Channel{enc: enc}
}

func (c *Channel) Send(event any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.enc.Encode(event)
}

// ReadCommands reads NDJSON commands from r until EOF or error, invoking onCommand for each valid command,
// and invokes onEOF when the parent process closes stdin (enabling automatic orphan prevention).
func ReadCommands(r io.Reader, onCommand func(InboundCommand), onEOF func()) {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var cmd InboundCommand
		if err := json.Unmarshal(line, &cmd); err != nil {
			continue
		}
		if cmd.Type != "" && onCommand != nil {
			onCommand(cmd)
		}
	}
	if onEOF != nil {
		onEOF()
	}
}
