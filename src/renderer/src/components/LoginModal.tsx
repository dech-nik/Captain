import React, { useEffect, useRef, useState } from 'react'
import type { LoginStep, LoginUiState, TeleportMfaMode } from '@shared/types'
import { CaptainWordmark } from './BrandMark'
import { EmbeddedTerminal } from './EmbeddedTerminal'

interface LoginModalProps {
  login: LoginUiState
}

function getTeleportHeading(step: LoginStep): { title: string; subtitle: string } {
  switch (step) {
    case 'proxy_input':
      return {
        title: 'Mit Teleport verbinden',
        subtitle: 'Geben Sie Ihre Teleport-Cluster-Adresse und Ihre Benutzeridentität an.'
      }
    case 'username':
      return {
        title: 'Bei Teleport anmelden',
        subtitle: 'Bestätigen Sie Ihren Teleport-Benutzernamen.'
      }
    case 'password':
      return {
        title: 'Bei Teleport anmelden',
        subtitle: 'Geben Sie Ihr Passwort ein, um fortzufahren.'
      }
    case 'yubikey_pin':
      return {
        title: 'Hardware-Key entsperren',
        subtitle: 'Geben Sie die PIN Ihres Sicherheitsschlüssels ein.'
      }
    case 'yubikey_touch':
      return {
        title: 'Identität bestätigen',
        subtitle: 'Berühren Sie Ihren registrierten Hardware-Sicherheitsschlüssel.'
      }
    case 'mfa_touch_or_otp':
      return {
        title: 'Zwei-Faktor-Verifizierung',
        subtitle: 'Bestätigen Sie die Anmeldung per Security-Key oder Authenticator-Code.'
      }
    case 'otp':
      return {
        title: 'Zwei-Faktor-Verifizierung',
        subtitle: 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.'
      }
    case 'syncing_kubeconfig':
      return {
        title: 'Cluster werden geladen',
        subtitle: 'Verfügbare Kubernetes-Kontexte werden aus Teleport synchronisiert…'
      }
    case 'success':
      return {
        title: 'Erfolgreich angemeldet',
        subtitle: 'Ihre Teleport-Sitzung ist aktiv.'
      }
    case 'error':
      return {
        title: 'Anmeldung nicht möglich',
        subtitle: 'Prüfen Sie Ihre Zugangsdaten oder passen Sie die Teleport-Identität an.'
      }
    default:
      return {
        title: 'Verbindung zu Teleport',
        subtitle: 'Sichere Authentifizierungssitzung wird vorbereitet…'
      }
  }
}

function computeInitials(username?: string): string {
  if (!username) return 'TP'
  const local = username.split('@')[0] || username
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

function formatHostDisplay(proxyAddr?: string): string | undefined {
  if (!proxyAddr) return undefined
  return proxyAddr.replace(/:443$/, '')
}

function mfaLabel(mode: TeleportMfaMode): string {
  switch (mode) {
    case 'cross-platform':
      return 'Hardware-Key (FIDO2)'
    case 'platform':
      return 'Passkey / Touch ID'
    case 'otp':
      return 'Authenticator (TOTP)'
    default:
      return 'Automatisch'
  }
}

export const LoginModal: React.FC<LoginModalProps> = ({ login }) => {
  const [inputValue, setInputValue] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [proxyInput, setProxyInput] = useState(login.teleport.proxyAddr || '')
  const [usernameOverride, setUsernameOverride] = useState(login.teleport.username || '')
  const [mfaMode, setMfaMode] = useState<TeleportMfaMode>(login.mfaMode || 'auto')
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const proxyInputRef = useRef<HTMLInputElement | null>(null)

  const showTerminal = terminalOpen || login.forceTerminalOpen
  const heading = getTeleportHeading(login.step)

  const needsTextInput =
    login.step === 'password' ||
    login.step === 'yubikey_pin' ||
    login.step === 'otp' ||
    login.step === 'mfa_touch_or_otp' ||
    login.step === 'username' ||
    login.step === 'unknown_prompt'

  const showYubikeyTouchBox =
    login.step === 'yubikey_touch' || login.step === 'mfa_touch_or_otp'

  const isSecretField = login.step === 'password' || login.step === 'yubikey_pin'
  const isOtpStep = login.step === 'otp' || login.step === 'mfa_touch_or_otp'

  useEffect(() => {
    if (login.teleport.proxyAddr) {
      setProxyInput(login.teleport.proxyAddr)
    }
  }, [login.teleport.proxyAddr])

  useEffect(() => {
    if (login.teleport.username) {
      setUsernameOverride(login.teleport.username)
    }
  }, [login.teleport.username])

  useEffect(() => {
    setMfaMode(login.mfaMode || 'auto')
  }, [login.mfaMode])

  useEffect(() => {
    setInputValue(login.step === 'username' ? login.teleport.username || '' : '')
    setShowSecret(false)
    if (login.step === 'proxy_input') {
      setEditingIdentity(false)
      setTimeout(() => proxyInputRef.current?.focus(), 40)
    } else if (needsTextInput && !editingIdentity) {
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [login.step, needsTextInput, editingIdentity, login.teleport.username])

  const handleProxySubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!proxyInput.trim()) return
    await window.launcherApi.submitProxyConfig(
      proxyInput.trim(),
      usernameOverride.trim() || undefined,
      mfaMode
    )
  }

  const handleApplyIdentitySwitch = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setEditingIdentity(false)
    setInputValue('')
    await window.launcherApi.retryAuth(
      usernameOverride.trim() || undefined,
      proxyInput.trim() || undefined,
      mfaMode
    )
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const payload = login.step === 'password' ? inputValue : inputValue.trim()
    if (!payload && login.step !== 'password') return
    setInputValue('')
    await window.launcherApi.submitAuthInput(payload)
  }

  const handleRetry = async (): Promise<void> => {
    setInputValue('')
    await window.launcherApi.retryAuth(
      usernameOverride.trim() || undefined,
      proxyInput.trim() || undefined,
      mfaMode
    )
  }

  const getFieldLabel = (): string => {
    switch (login.step) {
      case 'password':
        return 'Passwort'
      case 'yubikey_pin':
        return 'Security-Key PIN'
      case 'mfa_touch_or_otp':
      case 'otp':
        return 'Authenticator-Code (TOTP)'
      case 'username':
        return 'Benutzername'
      default:
        return login.promptText || 'Eingabe'
    }
  }

  const getSubmitButtonLabel = (): string => {
    switch (login.step) {
      case 'password':
      case 'username':
        return 'Weiter zur Anmeldung'
      case 'otp':
      case 'mfa_touch_or_otp':
        return 'Code bestätigen'
      case 'yubikey_pin':
        return 'PIN bestätigen'
      default:
        return 'Fortfahren'
    }
  }

  const hostDisplay = formatHostDisplay(login.teleport.proxyAddr)

  return (
    <div className="overlay-backdrop">
      <div className={`dialog-shell ${showTerminal ? 'dialog-shell-wide' : ''}`}>
        <div className="dialog-accent-bar" />

        {/* Clean Captain Top Frame */}
        <div className="dialog-header">
          <div className="header-brand-row">
            <CaptainWordmark height={28} />
          </div>

          <div className="header-actions">
            {login.step !== 'proxy_input' && (
              <button
                type="button"
                className={`btn-ghost-icon ${showTerminal ? 'is-open' : ''}`}
                onClick={() => setTerminalOpen((prev) => !prev)}
                title="Interaktive tsh-Konsole ein-/ausblenden"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>Konsole</span>
              </button>
            )}
            <button
              type="button"
              className="btn-ghost-icon"
              onClick={() => window.launcherApi.openSettings()}
              title="Captain Einstellungen öffnen"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Einstellungen</span>
            </button>
          </div>
        </div>

        <div className="dialog-body">
          {/* Teleport Sign-In Header */}
          <div className="teleport-auth-hero">
            <h2 className="teleport-auth-title">{heading.title}</h2>
            <p className="teleport-auth-subtitle">{heading.subtitle}</p>
            {hostDisplay && login.step !== 'proxy_input' && (
              <div className="teleport-cluster-pill">
                <span className="teleport-cluster-dot" />
                <span>{hostDisplay}</span>
                {login.teleport.kubeCluster && (
                  <>
                    <span style={{ color: '#cbd5e1' }}>/</span>
                    <span>{login.teleport.kubeCluster}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Visible User Identity Card + Inline Account Switcher */}
          {login.step !== 'proxy_input' && login.step !== 'error' && (
            <>
              <div className="identity-card">
                <div className="identity-card-left">
                  <div className="identity-avatar">
                    {computeInitials(login.teleport.username)}
                  </div>
                  <div className="identity-meta">
                    <span className="identity-user">
                      {login.teleport.username || 'Lokaler System-Benutzer'}
                    </span>
                    <span className="identity-sub">
                      <span>{login.teleport.proxyAddr || 'Teleport-Gateway'}</span>
                      {login.mfaMode !== 'auto' && (
                        <>
                          <span>·</span>
                          <span>{mfaLabel(login.mfaMode)}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="identity-edit-btn"
                  onClick={() => setEditingIdentity((prev) => !prev)}
                >
                  {editingIdentity ? 'Schließen' : 'Konto ändern'}
                </button>
              </div>

              {editingIdentity && (
                <form className="identity-editor-panel form-stack" onSubmit={handleApplyIdentitySwitch}>
                  <div className="field-block">
                    <label className="field-label">Teleport-Benutzername</label>
                    <div className="input-well">
                      <input
                        type="text"
                        className="well-input"
                        value={usernameOverride}
                        onChange={(e) => setUsernameOverride(e.target.value)}
                        placeholder="user@example.com"
                        autoComplete="username"
                        spellCheck={false}
                      />
                    </div>
                  </div>

                  <div className="field-block">
                    <label className="field-label">Teleport Proxy-Server</label>
                    <div className="input-well">
                      <input
                        type="text"
                        className="well-input"
                        value={proxyInput}
                        onChange={(e) => setProxyInput(e.target.value)}
                        placeholder="teleport.example.com:443"
                        spellCheck={false}
                      />
                    </div>
                  </div>

                  <div className="field-block">
                    <label className="field-label">Zwei-Faktor-Methode</label>
                    <div className="input-well">
                      <select
                        className="well-select"
                        value={mfaMode}
                        onChange={(e) => setMfaMode(e.target.value as TeleportMfaMode)}
                      >
                        <option value="auto">Automatisch (Vom Server vorgeschlagen)</option>
                        <option value="cross-platform">Hardware-Sicherheitsschlüssel (YubiKey / FIDO2)</option>
                        <option value="platform">Geräte-Passkey / Touch ID</option>
                        <option value="otp">Authenticator-App (TOTP Einmalcode)</option>
                      </select>
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary btn-block" disabled={!proxyInput.trim()}>
                    Mit dieser Identität neu verbinden
                  </button>
                </form>
              )}
            </>
          )}

          {login.errorMessage && (
            <div className="callout-error">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{login.errorMessage}</span>
            </div>
          )}

          {/* STEP 0: Initial Teleport Server & Identity Setup */}
          {login.step === 'proxy_input' && (
            <form id="proxy-setup-form" className="form-stack" onSubmit={handleProxySubmit}>
              <div className="field-block">
                <label className="field-label">Teleport-Cluster / Proxy-Adresse</label>
                <div className="input-well">
                  <span className="input-leading-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </span>
                  <input
                    ref={proxyInputRef}
                    type="text"
                    className="well-input"
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    placeholder="teleport.example.com:443"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="field-block">
                <div className="field-label-row">
                  <label className="field-label">Benutzername</label>
                  <span className="field-hint">Wird für künftige Sitzungen gemerkt</span>
                </div>
                <div className="input-well">
                  <span className="input-leading-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    className="well-input"
                    value={usernameOverride}
                    onChange={(e) => setUsernameOverride(e.target.value)}
                    placeholder="user@example.com"
                    autoComplete="username"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="field-block">
                <label className="field-label">Bevorzugter 2. Faktor</label>
                <div className="input-well">
                  <select
                    className="well-select"
                    value={mfaMode}
                    onChange={(e) => setMfaMode(e.target.value as TeleportMfaMode)}
                  >
                    <option value="auto">Automatisch</option>
                    <option value="cross-platform">Hardware-Key (YubiKey / FIDO2)</option>
                    <option value="platform">Passkey / Touch ID</option>
                    <option value="otp">Authenticator-App (TOTP)</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={!proxyInput.trim()}>
                <span>Weiter zu Teleport</span>
                <span className="kbd-hint">↵</span>
              </button>
            </form>
          )}

          {/* Hardware Security Key Touch Stage */}
          {!editingIdentity && showYubikeyTouchBox && (
            <div className="hardware-key-stage">
              <div className="hardware-key-beacon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="8" width="14" height="8" rx="2" />
                  <path d="M17 10h4v4h-4" />
                  <circle className="key-led" cx="10" cy="12" r="1.8" fill="#059669" stroke="none" />
                </svg>
              </div>
              <div className="hardware-key-copy">
                <span className="hardware-key-title">Security-Key jetzt berühren</span>
                <span className="hardware-key-sub">
                  Berühren Sie den blinkenden Sensor Ihres YubiKeys oder FIDO2-Schlüssels.
                </span>
              </div>
            </div>
          )}

          {!editingIdentity && login.step === 'mfa_touch_or_otp' && (
            <div className="or-divider">oder mit Einmalcode anmelden</div>
          )}

          {/* Primary Teleport Password / PIN / OTP Form */}
          {!editingIdentity && needsTextInput && (
            <form id="auth-step-form" className="form-stack" onSubmit={handleSubmit}>
              <div className="field-block">
                <label className="field-label">{getFieldLabel()}</label>
                <div className="input-well">
                  <span className="input-leading-icon">
                    {isOtpStep ? (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                    ) : isSecretField ? (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    )}
                  </span>
                  <input
                    ref={inputRef}
                    type={isSecretField && !showSecret ? 'password' : 'text'}
                    className={`well-input ${isOtpStep ? 'well-input-otp' : ''}`}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={
                      login.step === 'yubikey_pin'
                        ? 'Security-Key PIN eingeben'
                        : isOtpStep
                          ? '000000'
                          : login.step === 'username'
                            ? 'user@example.com'
                            : login.step === 'password'
                              ? 'Passwort eingeben'
                              : 'Antwort eingeben…'
                    }
                    autoComplete={
                      isOtpStep ? 'one-time-code' : login.step === 'password' ? 'current-password' : 'off'
                    }
                    spellCheck={false}
                  />
                  {isSecretField && (
                    <button
                      type="button"
                      className="well-icon-btn"
                      onClick={() => setShowSecret((prev) => !prev)}
                      tabIndex={-1}
                      title={showSecret ? 'Passwort verbergen' : 'Passwort anzeigen'}
                    >
                      {showSecret ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-block">
                <span>{getSubmitButtonLabel()}</span>
                <span className="kbd-hint">↵</span>
              </button>
            </form>
          )}

          {/* Transitional states */}
          {!editingIdentity &&
            (login.step === 'starting' ||
              login.step === 'authenticating' ||
              login.step === 'syncing_kubeconfig') && (
              <div className="progress-stage">
                <div className="ring-spinner" />
                <span className="progress-text">{login.promptText}</span>
              </div>
            )}

          {login.step === 'success' && (
            <div className="callout-success">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>{login.promptText}</span>
            </div>
          )}

          {/* Error Recovery Form with Direct Identity & Proxy Controls */}
          {login.step === 'error' && (
            <div className="form-stack">
              <div className="field-block">
                <label className="field-label">Teleport-Benutzername</label>
                <div className="input-well">
                  <input
                    type="text"
                    className="well-input"
                    value={usernameOverride}
                    onChange={(e) => setUsernameOverride(e.target.value)}
                    placeholder="user@example.com"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="field-block">
                <label className="field-label">Teleport Proxy-Adresse</label>
                <div className="input-well">
                  <input
                    type="text"
                    className="well-input"
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    placeholder="teleport.example.com:443"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="field-block">
                <label className="field-label">Zwei-Faktor-Methode</label>
                <div className="input-well">
                  <select
                    className="well-select"
                    value={mfaMode}
                    onChange={(e) => setMfaMode(e.target.value as TeleportMfaMode)}
                  >
                    <option value="auto">Automatisch</option>
                    <option value="cross-platform">Hardware-Key (YubiKey / FIDO2)</option>
                    <option value="platform">Passkey / Touch ID</option>
                    <option value="otp">Authenticator-App (TOTP)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <EmbeddedTerminal visible={showTerminal && login.step !== 'proxy_input'} />
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.launcherApi.cancelAuth()}
          >
            {login.step === 'proxy_input' ? 'Ohne Teleport fortfahren' : 'Abbrechen'}
          </button>

          <div className="footer-right">
            {!login.active && login.step === 'error' && (
              <button type="button" className="btn btn-primary" onClick={handleRetry}>
                <span>Erneut anmelden</span>
                <span className="kbd-hint">↵</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
