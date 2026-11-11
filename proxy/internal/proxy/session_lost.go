package proxy

import (
	"net/http"
	"sort"

	"captain/proxy/internal/kubeconfig"
)

// loggedOutAuthReason is returned to Radar as an HTTP 401 status message and sent to Electron
// as auth:required. HTTP 401 is what tells Radar the API is reachable, so the cluster stays
// auth-rejected instead of flipping to an offline / disconnected view.
const loggedOutAuthReason = "Teleport session ended (tsh logout); authentication required"

// PlanLoggedOutTeleportContexts computes the registry Radar should keep seeing after a kubeconfig
// reload. `tsh logout` deletes Teleport contexts, and Radar then fails its own switch preflight
// ("context is no longer available") or falls through to a remaining local cluster that may be
// down — both look offline, and neither request reaches this proxy.
//
// Vanished Teleport contexts stay in the merged registry so Radar keeps calling the proxy.
// Requests for them are answered with HTTP 401. A context is only retained when every context
// of that Teleport proxy disappeared; removing one cluster while a sibling remains is not a logout.
//
// commit stores the plan. Call it only after the synthetic kubeconfig was written successfully.
func (s *Server) PlanLoggedOutTeleportContexts(next *kubeconfig.Registry) (merged *kubeconfig.Registry, lost []kubeconfig.ContextEntry, commit func()) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if next == nil {
		next = &kubeconfig.Registry{Entries: map[string]kubeconfig.ContextEntry{}}
	}

	known := copyTeleportEntries(s.knownTeleport)
	lostSet := copyLostSet(s.sessionLost)

	if s.registry != nil {
		for name, entry := range s.registry.Entries {
			if entry.Teleport.IsTeleport && !lostSet[name] {
				known[name] = entry
			}
		}
	}

	liveGroups := make(map[string]int)
	for name, entry := range next.Entries {
		if !entry.Teleport.IsTeleport {
			continue
		}
		known[name] = entry
		delete(lostSet, name)
		liveGroups[teleportGroup(entry)]++
	}

	merged = cloneRegistry(next)
	names := make([]string, 0, len(known))
	for name := range known {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		if _, stillThere := next.Entries[name]; stillThere {
			continue
		}
		entry := known[name]
		if !entry.Teleport.IsTeleport {
			delete(known, name)
			continue
		}
		if liveGroups[teleportGroup(entry)] > 0 {
			delete(known, name)
			delete(lostSet, name)
			continue
		}
		if !lostSet[name] {
			lost = append(lost, entry)
		}
		lostSet[name] = true
		if _, exists := merged.Entries[name]; !exists {
			merged.Entries[name] = entry
			merged.OrderedNames = append(merged.OrderedNames, name)
		}
	}

	if s.registry != nil && lostSet[s.registry.CurrentContext] {
		if _, stillThere := next.Entries[s.registry.CurrentContext]; !stillThere {
			merged.CurrentContext = s.registry.CurrentContext
		}
	}

	knownSnap := known
	lostSnap := lostSet
	commit = func() {
		s.mu.Lock()
		s.knownTeleport = knownSnap
		s.sessionLost = lostSnap
		s.mu.Unlock()
	}
	return merged, lost, commit
}

// EmitLoggedOutAuth notifies Electron once per Teleport proxy that a logout removed its clusters.
func (s *Server) EmitLoggedOutAuth(entries []kubeconfig.ContextEntry) {
	for _, entry := range entries {
		s.notifyAuthRequired(entry, loggedOutAuthReason, http.StatusUnauthorized)
	}
}

func (s *Server) loggedOutTeleport(name string) (kubeconfig.ContextEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.sessionLost[name] {
		return kubeconfig.ContextEntry{}, false
	}
	entry, ok := s.knownTeleport[name]
	if !ok && s.registry != nil {
		entry, ok = s.registry.Entries[name]
	}
	if !ok || !entry.Teleport.IsTeleport {
		return kubeconfig.ContextEntry{}, false
	}
	return entry, true
}

func (s *Server) lookupEntry(name string) (kubeconfig.ContextEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.registry == nil {
		return kubeconfig.ContextEntry{}, false
	}
	entry, ok := s.registry.Entries[name]
	return entry, ok
}

func teleportGroup(entry kubeconfig.ContextEntry) string {
	if entry.Teleport.ProxyAddr != "" || entry.Teleport.TeleportCluster != "" {
		return entry.Teleport.ProxyAddr + "\x00" + entry.Teleport.TeleportCluster
	}
	return "name\x00" + entry.QualifiedName
}

func cloneRegistry(reg *kubeconfig.Registry) *kubeconfig.Registry {
	out := &kubeconfig.Registry{
		Entries:        make(map[string]kubeconfig.ContextEntry, len(reg.Entries)+4),
		OrderedNames:   append([]string(nil), reg.OrderedNames...),
		CurrentContext: reg.CurrentContext,
		WatchedPaths:   reg.WatchedPaths,
	}
	for name, entry := range reg.Entries {
		out.Entries[name] = entry
	}
	return out
}

func copyTeleportEntries(in map[string]kubeconfig.ContextEntry) map[string]kubeconfig.ContextEntry {
	out := make(map[string]kubeconfig.ContextEntry, len(in))
	for name, entry := range in {
		out[name] = entry
	}
	return out
}

func copyLostSet(in map[string]bool) map[string]bool {
	out := make(map[string]bool, len(in))
	for name, lost := range in {
		if lost {
			out[name] = true
		}
	}
	return out
}
