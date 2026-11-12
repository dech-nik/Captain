import React, { useEffect, useState } from 'react'
import {
  acceleratorFromKeyboardEvent,
  DEFAULT_SHORTCUT_BINDINGS,
  formatShortcutKeycaps,
  getRadarShortcutConflictWarning,
  SHORTCUT_ACTIONS
} from '@shared/shortcuts'
import {
  PALETTE_SLOT_COUNT,
  type BinarySettings,
  type CaptainPreferences,
  type ShortcutActionId,
  type ShortcutBindings,
  type TeleportMfaMode,
  type WorkspaceOrganizerState
} from '@shared/types'
import { CaptainWordmark } from './BrandMark'
import { LockIcon, TrashBinIcon } from './K8sIcons'

interface SettingsModalProps {
  binaries: BinarySettings
  preferences: CaptainPreferences
  workspace: WorkspaceOrganizerState
  errorMessage?: string
  canClose: boolean
}

type SettingsSection = 'teleport' | 'workspace' | 'palettes' | 'controls' | 'system'

export const SettingsModal: React.FC<SettingsModalProps> = ({
  binaries,
  preferences,
  workspace,
  errorMessage,
  canClose
}) => {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)

  const [activeSection, setActiveSection] = useState<SettingsSection>(
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
  const [blurRadarBackdrop, setBlurRadarBackdrop] = useState(
    preferences.blurRadarBackdrop
  )
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>({
    ...preferences.shortcuts
  })
  const [enableSlotShortcuts, setEnableSlotShortcuts] = useState(
    preferences.enableSlotShortcuts
  )

  const [recordingAction, setRecordingAction] = useState<ShortcutActionId | null>(null)
  const [newPaletteName, setNewPaletteName] = useState('')
  const [editingPaletteId, setEditingPaletteId] = useState<string | null>(null)
  const [editingPaletteDraft, setEditingPaletteDraft] = useState('')

  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [identityCleared, setIdentityCleared] = useState(false)

  useEffect(() => {
    void window.launcherApi.setShortcutCaptureActive(recordingAction !== null)
    return () => {
      void window.launcherApi.setShortcutCaptureActive(false)
    }
  }, [recordingAction])

  useEffect(() => {
    if (!recordingAction) return undefined

    const onCaptureKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingAction(null)
        return
      }

      const accel = acceleratorFromKeyboardEvent(e)
      if (!accel) return

      setShortcuts((prev) => ({
        ...prev,
        [recordingAction]: accel
      }))
      setRecordingAction(null)
    }

    window.addEventListener('keydown', onCaptureKeyDown, true)
    return () => window.removeEventListener('keydown', onCaptureKeyDown, true)
  }, [recordingAction])

  useEffect(() => {
    if (!canClose) return undefined
    const onKeyDown = (e: KeyboardEvent): void => {
      if (recordingAction) return
      if (e.key === 'Escape') {
        if (editingPaletteId) {
          setEditingPaletteId(null)
          return
        }
        void window.launcherApi.closeSettings()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canClose, recordingAction, editingPaletteId])

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

  const handleCreatePalette = async (): Promise<void> => {
    const clean = newPaletteName.trim()
    await window.launcherApi.createPalette(clean || undefined)
    setNewPaletteName('')
  }

  const handleCommitPaletteRename = async (paletteId: string): Promise<void> => {
    if (editingPaletteDraft.trim()) {
      await window.launcherApi.renamePalette(paletteId, editingPaletteDraft.trim())
    }
    setEditingPaletteId(null)
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
          showTerminalByDefault,
          blurRadarBackdrop,
          shortcuts,
          enableSlotShortcuts
        }
      })
    } finally {
      setSaving(false)
    }
  }

  const findDuplicateShortcutOwner = (
    actionId: ShortcutActionId,
    accel: string
  ): string | null => {
    for (const meta of SHORTCUT_ACTIONS) {
      if (meta.id !== actionId && shortcuts[meta.id] === accel) {
        return meta.label
      }
    }
    return null
  }

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!canClose || recordingAction) return
    if (e.target === e.currentTarget) {
      void window.launcherApi.closeSettings()
    }
  }

  return (
    <div
      className={`overlay-backdrop ${
        !canClose ? 'overlay-backdrop-solid' : 'overlay-backdrop-glass'
      }`}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="dialog-shell dialog-shell-settings-wide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-accent-bar" />

        <div className="dialog-header">
          <div className="header-brand-row">
            <CaptainWordmark height={26} />
            <span className="header-divider" />
            <span className="header-tag">Einstellungen</span>
          </div>

          {canClose && (
            <button
              type="button"
              className="btn-ghost-icon"
              onClick={() => void window.launcherApi.closeSettings()}
              title="Schließen (Esc)"
              aria-label="Schließen"
            >
              <span>✕</span>
            </button>
          )}
        </div>

        <div className="settings-split-layout">
          <nav className="settings-nav-rail" aria-label="Einstellungsbereiche">
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'teleport' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('teleport')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Teleport & Identität</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'workspace' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('workspace')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
              </svg>
              <span>Arbeitsbereich</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'palettes' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('palettes')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="10" rx="2" />
                <line x1="8.5" y1="7" x2="8.5" y2="17" />
                <line x1="15.5" y1="7" x2="15.5" y2="17" />
              </svg>
              <span>Paletten</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'controls' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('controls')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="6" y1="9" x2="6.01" y2="9" />
                <line x1="10" y1="9" x2="10.01" y2="9" />
                <line x1="14" y1="9" x2="14.01" y2="9" />
                <line x1="18" y1="9" x2="18.01" y2="9" />
                <line x1="8" y1="15" x2="16" y2="15" />
              </svg>
              <span>Steuerung</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'system' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('system')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>System & Werkzeuge</span>
            </button>
          </nav>

          <div className="settings-content-pane">
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
              {/* SECTION 1: TELEPORT & IDENTITY */}
              {activeSection === 'teleport' && (
                <>
                  <div className="settings-pane-intro">
                    <h3 className="settings-pane-title">Teleport & Identität</h3>
                    <p className="settings-pane-desc">
                      Standard-Verbindungswerte und Zwei-Faktor-Verfahren für die integrierte{' '}
                      <code>tsh</code>-Anmeldung.
                    </p>
                  </div>

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
                        <option value="cross-platform">
                          Hardware-Sicherheitsschlüssel (YubiKey / FIDO2)
                        </option>
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
                      onClick={() => void handleClearIdentity()}
                    >
                      Identität zurücksetzen
                    </button>
                  </div>
                </>
              )}

              {/* SECTION 2: WORKSPACE & APPEARANCE */}
              {activeSection === 'workspace' && (
                <>
                  <div className="settings-pane-intro">
                    <h3 className="settings-pane-title">Arbeitsbereich</h3>
                    <p className="settings-pane-desc">
                      Darstellung über Radar sowie Synchronisierung von Teleport-Clustern.
                    </p>
                  </div>

                  <div className="pref-card-list">
                    <div
                      className="pref-toggle-row"
                      onClick={() => setBlurRadarBackdrop((prev) => !prev)}
                    >
                      <div className="pref-toggle-copy">
                        <span className="pref-toggle-title">
                          Radar-Hintergrund bei geöffneten Menüs weichzeichnen
                        </span>
                        <span className="pref-toggle-desc">
                          Zeichnet den aktiven Arbeitsbereich hinter Paletten und Einstellungen sanft
                          weich, statt ihn auszublenden.
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={blurRadarBackdrop}
                        className={`switch-track ${blurRadarBackdrop ? 'is-on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setBlurRadarBackdrop((prev) => !prev)
                        }}
                      >
                        <span className="switch-thumb" />
                      </button>
                    </div>

                    <div
                      className="pref-toggle-row"
                      onClick={() => setSyncAllClusters((prev) => !prev)}
                    >
                      <div className="pref-toggle-copy">
                        <span className="pref-toggle-title">
                          Alle Teleport-Cluster automatisch synchronisieren
                        </span>
                        <span className="pref-toggle-desc">
                          Führt nach der Anmeldung <code>tsh kube login --all</code> aus, damit
                          sämtliche berechtigten Kubernetes-Cluster verfügbar sind.
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
                </>
              )}

              {/* SECTION 3: PALETTES */}
              {activeSection === 'palettes' && (
                <>
                  <div className="settings-pane-intro">
                    <h3 className="settings-pane-title">Ansichts-Paletten</h3>
                    <p className="settings-pane-desc">
                      Verwalten Sie Ihre gespeicherten Paletten. Jede Palette fasst {PALETTE_SLOT_COUNT}{' '}
                      horizontale Ansichten.
                    </p>
                  </div>

                  <div className="field-block">
                    <div className="palette-manage-list">
                      {workspace.palettes.map((palette) => {
                        const occupied = palette.slots.filter(Boolean).length
                        const isCurrent = palette.id === workspace.activePaletteId

                        return (
                          <div key={palette.id} className="palette-manage-row">
                            <div className="palette-manage-left">
                              {editingPaletteId === palette.id ? (
                                <input
                                  type="text"
                                  className="palette-inline-edit-input"
                                  value={editingPaletteDraft}
                                  onChange={(e) => setEditingPaletteDraft(e.target.value)}
                                  onBlur={() => void handleCommitPaletteRename(palette.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void handleCommitPaletteRename(palette.id)
                                    }
                                  }}
                                  autoFocus
                                  maxLength={48}
                                />
                              ) : (
                                <>
                                  <span className="palette-manage-name">{palette.name}</span>
                                  {isCurrent && <span className="pill-active-tag">Aktiv</span>}
                                  <span className="palette-manage-meta">
                                    {occupied}/{PALETTE_SLOT_COUNT}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="palette-manage-actions">
                              {!isCurrent && (
                                <button
                                  type="button"
                                  className="palette-mini-btn"
                                  onClick={() =>
                                    void window.launcherApi.selectPalette(palette.id)
                                  }
                                >
                                  Auswählen
                                </button>
                              )}

                              {!palette.locked && (
                                <>
                                  <button
                                    type="button"
                                    className="palette-mini-btn"
                                    onClick={() => {
                                      setEditingPaletteId(palette.id)
                                      setEditingPaletteDraft(palette.name)
                                    }}
                                  >
                                    Umbenennen
                                  </button>

                                  {occupied > 0 && (
                                    <button
                                      type="button"
                                      className="palette-mini-btn"
                                      onClick={() =>
                                        void window.launcherApi.clearPaletteSlots(palette.id)
                                      }
                                    >
                                      Leeren
                                    </button>
                                  )}
                                </>
                              )}

                              <button
                                type="button"
                                className={`palette-icon-chip ${
                                  palette.locked ? 'is-locked' : ''
                                }`}
                                onClick={() =>
                                  void window.launcherApi.setPaletteLocked(
                                    palette.id,
                                    !palette.locked
                                  )
                                }
                                title={palette.locked ? 'Palette entsperren' : 'Palette sperren'}
                                aria-label={
                                  palette.locked ? 'Palette entsperren' : 'Palette sperren'
                                }
                              >
                                <LockIcon locked={palette.locked} size={13} />
                              </button>

                              {!palette.locked && workspace.palettes.length > 1 && (
                                <button
                                  type="button"
                                  className="palette-icon-chip is-danger"
                                  onClick={() =>
                                    void window.launcherApi.deletePalette(palette.id)
                                  }
                                  title="Palette löschen"
                                  aria-label="Palette löschen"
                                >
                                  <TrashBinIcon size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="input-action-row" style={{ marginTop: '8px' }}>
                      <div className="input-well">
                        <input
                          type="text"
                          className="well-input"
                          value={newPaletteName}
                          onChange={(e) => setNewPaletteName(e.target.value)}
                          placeholder="Neue Palette (z. B. Produktion, Incident, Staging)…"
                          maxLength={48}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleCreatePalette()
                            }
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleCreatePalette()}
                      >
                        Erstellen
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* SECTION 4: KEYBOARD CONTROLS */}
              {activeSection === 'controls' && (
                <>
                  <div className="settings-pane-intro">
                    <h3 className="settings-pane-title">Steuerung</h3>
                    <p className="settings-pane-desc">
                      Klicken Sie auf ein Tastenkürzel, um eine neue Kombination aufzunehmen.
                    </p>
                  </div>

                  <div className="shortcut-list">
                    {SHORTCUT_ACTIONS.map((action) => {
                      const currentAccel = shortcuts[action.id]
                      const isRecording = recordingAction === action.id
                      const keycaps = formatShortcutKeycaps(currentAccel, isMac)
                      const radarWarning = getRadarShortcutConflictWarning(currentAccel)
                      const duplicateWith = findDuplicateShortcutOwner(action.id, currentAccel)
                      const isCustom = currentAccel !== DEFAULT_SHORTCUT_BINDINGS[action.id]

                      return (
                        <div key={action.id} className="shortcut-row-wrap">
                          <div className="shortcut-row">
                            <div className="shortcut-copy">
                              <span className="shortcut-label">{action.label}</span>
                              <span className="shortcut-desc">{action.description}</span>
                            </div>

                            <div className="shortcut-controls">
                              <button
                                type="button"
                                className={`shortcut-recorder-btn ${
                                  isRecording ? 'is-recording' : ''
                                }`}
                                onClick={() =>
                                  setRecordingAction((prev) =>
                                    prev === action.id ? null : action.id
                                  )
                                }
                              >
                                {isRecording ? (
                                  <span className="recording-prompt">Taste drücken…</span>
                                ) : (
                                  <span className="keycap-group">
                                    {keycaps.map((cap, idx) => (
                                      <kbd key={`${action.id}-${idx}`} className="keycap-badge">
                                        {cap}
                                      </kbd>
                                    ))}
                                  </span>
                                )}
                              </button>

                              {isCustom && !isRecording && (
                                <button
                                  type="button"
                                  className="palette-mini-btn"
                                  onClick={() =>
                                    setShortcuts((prev) => ({
                                      ...prev,
                                      [action.id]: DEFAULT_SHORTCUT_BINDINGS[action.id]
                                    }))
                                  }
                                  title="Auf Standardwert zurücksetzen"
                                >
                                  ↺
                                </button>
                              )}
                            </div>
                          </div>

                          {(radarWarning || duplicateWith) && (
                            <div className="shortcut-warning-note">
                              {duplicateWith
                                ? `Konflikt mit „${duplicateWith}“.`
                                : radarWarning}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="pref-card-list">
                    <div
                      className="pref-toggle-row"
                      onClick={() => setEnableSlotShortcuts((prev) => !prev)}
                    >
                      <div className="pref-toggle-copy">
                        <span className="pref-toggle-title">
                          Direktwahl für Paletten-Slots ({isMac ? '⌥1' : 'Alt+1'}–
                          {isMac ? `⌥${PALETTE_SLOT_COUNT}` : `Alt+${PALETTE_SLOT_COUNT}`})
                        </span>
                        <span className="pref-toggle-desc">
                          Springt direkt zur gespeicherten Ansicht im jeweiligen Slot der aktiven
                          Palette.
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enableSlotShortcuts}
                        className={`switch-track ${enableSlotShortcuts ? 'is-on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEnableSlotShortcuts((prev) => !prev)
                        }}
                      >
                        <span className="switch-thumb" />
                      </button>
                    </div>
                  </div>

                  <div className="info-kv-row">
                    <span className="info-kv-key">Tastenkürzel</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 11px', fontSize: '12px' }}
                      onClick={() => {
                        setShortcuts({ ...DEFAULT_SHORTCUT_BINDINGS })
                        setEnableSlotShortcuts(true)
                      }}
                    >
                      Standard wiederherstellen
                    </button>
                  </div>
                </>
              )}

              {/* SECTION 5: SYSTEM & BINARIES */}
              {activeSection === 'system' && (
                <>
                  <div className="settings-pane-intro">
                    <h3 className="settings-pane-title">System & Werkzeuge</h3>
                    <p className="settings-pane-desc">
                      Pfade zu den lokal installierten CLI-Werkzeugen <code>tsh</code> und{' '}
                      <code>radar</code>.
                    </p>
                  </div>

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
                      <label className="field-label">
                        Lokales Cluster-Backend (radar / kubectl-radar)
                      </label>
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
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleBrowseRadar}
                      >
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
                        onClick={() => void handleRestartServices()}
                      >
                        {restarting ? 'Startet neu…' : 'Dienste neu starten'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </form>
          </div>
        </div>

        <div className="dialog-footer">
          {canClose ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void window.launcherApi.closeSettings()}
            >
              Abbrechen
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            form="settings-form"
            className="btn btn-primary"
            disabled={saving || recordingAction !== null}
          >
            <span>{saving ? 'Wird gespeichert…' : 'Speichern'}</span>
            <span className="kbd-hint">↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
