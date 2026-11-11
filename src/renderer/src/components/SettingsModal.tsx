import React, { useEffect, useState } from 'react'
import type { BinarySettings, CaptainPreferences, TeleportMfaMode } from '@shared/types'
import { CaptainWordmark } from './BrandMark'

interface SettingsModalProps {
  binaries: BinarySettings
  preferences: CaptainPreferences
  errorMessage?: string
  canClose: boolean
}

type SettingsTab = 'teleport' | 'workspace' | 'system'

export const SettingsModal: React.FC<SettingsModalProps> = ({
  binaries,
  preferences,
  errorMessage,
  canClose
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    !canClose ? 'system' : 'teleport'
  )

  const [radarPath, setRadarPath] = useState(binaries.radarPath)
  const [tshPath, setTshPath] = useState(binaries.tshPath)

  const [defaultTeleportProxy, setDefaultTeleportProxy] = useState(
    preferences.defaultTeleportProxy
  )
  const [defaultTeleportUser, setDefaultTeleportUser] = useState(
    preferences.defaultTeleportUser
  )
  const [mfaMode, setMfaMode] = useState<TeleportMfaMode>(preferences.mfaMode)
  const [syncAllClusters, setSyncAllClusters] = useState(preferences.syncAllClusters)
  const [autoSelectTeleportCluster, setAutoSelectTeleportCluster] = useState(
    preferences.autoSelectTeleportCluster
  )
  const [showTerminalByDefault, setShowTerminalByDefault] = useState(
    preferences.showTerminalByDefault
  )

  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [identityCleared, setIdentityCleared] = useState(false)

  useEffect(() => {
    if (!canClose) return undefined
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.launcherApi.closeSettings()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canClose])

  const handleBrowseRadar = async (): Promise<void> => {
    const picked = await window.launcherApi.pickBinaryFile(
      'Kubernetes-Backend Binary auswählen'
    )
    if (picked) setRadarPath(picked)
  }

  const handleBrowseTsh = async (): Promise<void> => {
    const picked = await window.launcherApi.pickBinaryFile('Teleport tsh CLI auswählen')
    if (picked) setTshPath(picked)
  }

  const handleClearIdentity = async (): Promise<void> => {
    await window.launcherApi.clearSavedIdentity()
    setDefaultTeleportProxy('')
    setDefaultTeleportUser('')
    setIdentityCleared(true)
    setTimeout(() => setIdentityCleared(false), 2500)
  }

  const handleRestartServices = async (): Promise<void> => {
    setRestarting(true)
    try {
      await window.launcherApi.restartBackend()
    } finally {
      setRestarting(false)
    }
  }

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      await window.launcherApi.saveSettings({
        radarPath,
        tshPath,
        preferences: {
          defaultTeleportProxy,
          defaultTeleportUser,
          mfaMode,
          syncAllClusters,
          autoSelectTeleportCluster,
          showTerminalByDefault
        }
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`overlay-backdrop ${!canClose ? 'overlay-backdrop-solid' : ''}`}>
      <div className="dialog-shell dialog-shell-settings">
        <div className="dialog-accent-bar" />

        <div className="dialog-header">
          <div className="header-brand-row">
            <CaptainWordmark height={28} />
            <span className="header-divider" />
            <span className="header-tag">Einstellungen</span>
          </div>

          {canClose && (
            <button
              type="button"
              className="btn-ghost-icon"
              onClick={() => window.launcherApi.closeSettings()}
              title="Schließen (Esc)"
            >
              <span>Schließen</span>
            </button>
          )}
        </div>

        <div className="dialog-body">
          <div className="settings-tabs" role="tablist" aria-label="Captain Einstellungen">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'teleport'}
              className={`settings-tab ${activeTab === 'teleport' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('teleport')}
            >
              Teleport & Identität
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'workspace'}
              className={`settings-tab ${activeTab === 'workspace' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('workspace')}
            >
              Arbeitsbereich
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'system'}
              className={`settings-tab ${activeTab === 'system' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('system')}
            >
              System & Werkzeuge
            </button>
          </div>

          {errorMessage && (
            <div className="callout-error">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          <form id="settings-form" className="form-stack" onSubmit={handleSave}>
            {activeTab === 'teleport' && (
              <>
                <div className="field-block">
                  <div className="field-label-row">
                    <label className="field-label">Standard Teleport-Proxy</label>
                    <span className="field-hint">Wird bei neuen Sitzungen vorausgefüllt</span>
                  </div>
                  <div className="input-well">
                    <input
                      type="text"
                      className="well-input"
                      value={defaultTeleportProxy}
                      onChange={(e) => setDefaultTeleportProxy(e.target.value)}
                      placeholder="teleport.example.com:443"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="field-block">
                  <div className="field-label-row">
                    <label className="field-label">Standard Teleport-Benutzername</label>
                    <span className="field-hint">Verhindert Rückfall auf lokalen OS-Account</span>
                  </div>
                  <div className="input-well">
                    <input
                      type="text"
                      className="well-input"
                      value={defaultTeleportUser}
                      onChange={(e) => setDefaultTeleportUser(e.target.value)}
                      placeholder="user@example.com"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="field-block">
                  <label className="field-label">Bevorzugtes Zwei-Faktor-Verfahren (MFA)</label>
                  <div className="input-well">
                    <select
                      className="well-select"
                      value={mfaMode}
                      onChange={(e) => setMfaMode(e.target.value as TeleportMfaMode)}
                    >
                      <option value="auto">Automatisch (Standard des Teleport-Clusters)</option>
                      <option value="cross-platform">Hardware-Sicherheitsschlüssel (YubiKey / FIDO2)</option>
                      <option value="platform">Plattform-Authenticator (Touch ID / Passkey)</option>
                      <option value="otp">Authenticator-App (TOTP Einmalcode)</option>
                    </select>
                  </div>
                </div>

                <div className="info-kv-row">
                  <span className="info-kv-key">
                    {identityCleared
                      ? 'Gespeicherte Anmeldedaten wurden zurückgesetzt.'
                      : 'Gespeicherte Anmeldeidentität'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 11px', fontSize: '12px' }}
                    onClick={handleClearIdentity}
                  >
                    Identität zurücksetzen
                  </button>
                </div>
              </>
            )}

            {activeTab === 'workspace' && (
              <div className="pref-card-list">
                <div
                  className="pref-toggle-row"
                  onClick={() => setSyncAllClusters((prev) => !prev)}
                >
                  <div className="pref-toggle-copy">
                    <span className="pref-toggle-title">
                      Alle Teleport-Cluster automatisch synchronisieren
                    </span>
                    <span className="pref-toggle-desc">
                      Führt nach der Anmeldung <code>tsh kube login --all</code> aus, damit sämtliche
                      berechtigten Kubernetes-Cluster sofort verfügbar sind.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={syncAllClusters}
                    className={`switch-track ${syncAllClusters ? 'is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSyncAllClusters((prev) => !prev)
                    }}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>

                <div
                  className="pref-toggle-row"
                  onClick={() => setAutoSelectTeleportCluster((prev) => !prev)}
                >
                  <div className="pref-toggle-copy">
                    <span className="pref-toggle-title">
                      Nach Anmeldung automatisch zu Teleport-Cluster wechseln
                    </span>
                    <span className="pref-toggle-desc">
                      Aktiviert direkt einen neu geladenen Teleport-Kontext, wenn zuvor nur ein
                      lokaler Cluster ausgewählt war.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSelectTeleportCluster}
                    className={`switch-track ${autoSelectTeleportCluster ? 'is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setAutoSelectTeleportCluster((prev) => !prev)
                    }}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>

                <div
                  className="pref-toggle-row"
                  onClick={() => setShowTerminalByDefault((prev) => !prev)}
                >
                  <div className="pref-toggle-copy">
                    <span className="pref-toggle-title">
                      Interaktive tsh-Konsole beim Login einblenden
                    </span>
                    <span className="pref-toggle-desc">
                      Öffnet das eingebettete Diagnose-Terminal während der Teleport-Anmeldung
                      standardmäßig aufgeklappt.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showTerminalByDefault}
                    className={`switch-track ${showTerminalByDefault ? 'is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowTerminalByDefault((prev) => !prev)
                    }}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'system' && (
              <>
                <div className="field-block">
                  <div className="field-label-row">
                    <label className="field-label">Teleport CLI (tsh)</label>
                    {binaries.resolvedTshPath ? (
                      <span className="pill-detected">● Erkannt</span>
                    ) : (
                      <span className="pill-missing">● Nicht gefunden</span>
                    )}
                  </div>
                  <div className="input-action-row">
                    <div className="input-well">
                      <input
                        type="text"
                        className="well-input"
                        value={tshPath}
                        onChange={(e) => setTshPath(e.target.value)}
                        placeholder={binaries.resolvedTshPath || 'Automatisch aus System-PATH'}
                        spellCheck={false}
                      />
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={handleBrowseTsh}>
                      Durchsuchen…
                    </button>
                  </div>
                </div>

                <div className="field-block">
                  <div className="field-label-row">
                    <label className="field-label">Lokales Cluster-Backend (radar / kubectl-radar)</label>
                    {binaries.resolvedRadarPath ? (
                      <span className="pill-detected">● Erkannt</span>
                    ) : (
                      <span className="pill-missing">● Nicht gefunden</span>
                    )}
                  </div>
                  <div className="input-action-row">
                    <div className="input-well">
                      <input
                        type="text"
                        className="well-input"
                        value={radarPath}
                        onChange={(e) => setRadarPath(e.target.value)}
                        placeholder={binaries.resolvedRadarPath || 'Automatisch aus System-PATH'}
                        spellCheck={false}
                      />
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={handleBrowseRadar}>
                      Durchsuchen…
                    </button>
                  </div>
                </div>

                <div className="info-kv-row">
                  <span className="info-kv-key">Aktive KUBECONFIG</span>
                  <span className="info-kv-val">{binaries.kubeconfigEnv}</span>
                </div>

                {canClose && (
                  <div className="info-kv-row">
                    <span className="info-kv-key">Lokale Proxy- & Cluster-Dienste</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 11px', fontSize: '12px' }}
                      disabled={restarting}
                      onClick={handleRestartServices}
                    >
                      {restarting ? 'Startet neu…' : 'Dienste neu starten'}
                    </button>
                  </div>
                )}
              </>
            )}
          </form>
        </div>

        <div className="dialog-footer">
          {canClose ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.launcherApi.closeSettings()}
            >
              Abbrechen
            </button>
          ) : (
            <span />
          )}
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={saving}>
            <span>{saving ? 'Wird gespeichert…' : 'Einstellungen speichern'}</span>
            <span className="kbd-hint">↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
