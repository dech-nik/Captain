import React, { useEffect, useState } from 'react'
import type { AppStatusState } from '@shared/types'
import { CaptainIcon, CaptainWordmark } from './components/BrandMark'
import { LoginModal } from './components/LoginModal'
import { SettingsModal } from './components/SettingsModal'
import { WorkspaceOverlay } from './components/WorkspaceOverlay'

export const App: React.FC = () => {
  const [state, setState] = useState<AppStatusState | null>(null)

  useEffect(() => {
    if (!window.launcherApi) return undefined
    window.launcherApi.getState().then(setState).catch(() => {})
    const unsubscribe = window.launcherApi.onStateChange((next) => {
      setState(next)
    })
    return () => unsubscribe()
  }, [])

  if (!state) {
    return null
  }

  if (state.settingsOpen || state.phase === 'missing_binaries') {
    return (
      <SettingsModal
        binaries={state.binaries}
        preferences={state.preferences}
        contexts={state.contexts}
        workspace={state.workspace}
        errorMessage={state.errorMessage}
        canClose={state.phase !== 'missing_binaries'}
      />
    )
  }

  if (state.phase === 'auth_required' && state.login) {
    return <LoginModal login={state.login} />
  }

  if (state.phase === 'starting') {
    return (
      <div className="overlay-backdrop overlay-backdrop-solid">
        <div className="dialog-shell">
          <div className="dialog-accent-bar" />
          <div className="dialog-header">
            <div className="header-brand-row">
              <CaptainWordmark height={28} />
            </div>
            <CaptainIcon size={24} animated />
          </div>
          <div className="dialog-body">
            <h2 className="section-title">Arbeitsbereich wird gestartet</h2>
            <p className="section-desc">
              Captain initialisiert das lokale Kubernetes-Gateway und verbindet Ihre Cluster-Umgebung.
            </p>
            <div className="progress-stage">
              <div className="ring-spinner" />
              <span className="progress-text">Lokale Dienste werden bereitgestellt…</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (state.phase === 'fatal_error') {
    return (
      <div className="overlay-backdrop overlay-backdrop-solid">
        <div className="dialog-shell">
          <div className="dialog-accent-bar" />
          <div className="dialog-header">
            <div className="header-brand-row">
              <CaptainWordmark height={28} />
              <span className="header-divider" />
              <span className="header-tag">Diagnose</span>
            </div>
          </div>
          <div className="dialog-body">
            <h2 className="section-title">Initialisierung fehlgeschlagen</h2>
            <p className="section-desc">
              Beim Starten des lokalen Kubernetes-Proxys oder der Cluster-Umgebung ist ein Fehler aufgetreten.
            </p>
            {state.errorMessage && (
              <div className="callout-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{state.errorMessage}</span>
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.launcherApi.openSettings()}
            >
              Einstellungen…
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.launcherApi.restartBackend()}
            >
              Erneut starten
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state.phase === 'ready' && state.workspace.overlayMode !== 'closed') {
    return (
      <WorkspaceOverlay
        contexts={state.contexts}
        currentContext={state.currentContext}
        workspace={state.workspace}
        preferences={state.preferences}
      />
    )
  }

  return null
}

export default App
