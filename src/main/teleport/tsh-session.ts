import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { promisify } from 'node:util'
import * as pty from 'node-pty'
import type { LoginUiState, TeleportMetadata, TeleportMfaMode } from '@shared/types'
import { TshPromptParser } from './prompt-parser'

const execFileAsync = promisify(execFile)

export interface StartLoginOptions {
  tshBinaryPath: string
  contextName: string
  reason: string
  teleport: TeleportMetadata
  usernameOverride?: string
  mfaMode?: TeleportMfaMode
  syncAllClusters?: boolean
  defaultTerminalOpen?: boolean
}

export class TshSessionManager extends EventEmitter {
  private ptyProc: pty.IPty | null = null
  private parser = new TshPromptParser()
  private state: LoginUiState | null = null
  private lastTshBinaryPath: string | null = null
  private lastSyncAllClusters = true
  private lastDefaultTerminalOpen = false

  public getState(): LoginUiState | null {
    return this.state
  }

  public isActive(): boolean {
    return (
      this.ptyProc !== null ||
      this.state?.step === 'proxy_input' ||
      this.state?.step === 'syncing_kubeconfig'
    )
  }

  public startLogin(opts: StartLoginOptions): LoginUiState {
    this.killCurrentPty()
    this.parser.reset()
    this.lastTshBinaryPath = opts.tshBinaryPath
    this.lastSyncAllClusters = opts.syncAllClusters ?? true
    this.lastDefaultTerminalOpen = opts.defaultTerminalOpen ?? false
    const mfaMode: TeleportMfaMode = opts.mfaMode ?? 'auto'

    // If no Teleport proxy address is known yet (e.g. after `tsh logout` wiped ~/.kube/config and ~/.tsh),
    // ask the user for the Teleport Proxy URL inside the modal before spawning `tsh login`.
    if (!opts.teleport.proxyAddr || opts.teleport.proxyAddr.trim() === '') {
      const username = opts.usernameOverride?.trim() || opts.teleport.username?.trim() || undefined
      this.state = {
        active: true,
        context: opts.contextName,
        reason: opts.reason,
        teleport: { ...opts.teleport, isTeleport: true, ...(username ? { username } : {}) },
        mfaMode,
        step: 'proxy_input',
        promptText: 'Teleport-Serveradresse angeben',
        forceTerminalOpen: this.lastDefaultTerminalOpen
      }
      this.emitState()
      return this.state
    }

    return this.spawnTshLoginPty({
      ...opts,
      mfaMode,
      syncAllClusters: this.lastSyncAllClusters,
      defaultTerminalOpen: this.lastDefaultTerminalOpen
    })
  }

  public submitProxyConfig(
    proxyAddr: string,
    usernameOverride?: string,
    mfaMode?: TeleportMfaMode
  ): LoginUiState | null {
    const cleanProxy = proxyAddr.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    if (!cleanProxy || !this.state || !this.lastTshBinaryPath) return this.state

    const username = usernameOverride?.trim() || this.state.teleport.username
    return this.spawnTshLoginPty({
      tshBinaryPath: this.lastTshBinaryPath,
      contextName: this.state.context,
      reason: this.state.reason,
      teleport: {
        ...this.state.teleport,
        isTeleport: true,
        proxyAddr: cleanProxy,
        username
      },
      usernameOverride: username,
      mfaMode: mfaMode ?? this.state.mfaMode,
      syncAllClusters: this.lastSyncAllClusters,
      defaultTerminalOpen: this.lastDefaultTerminalOpen
    })
  }

  private spawnTshLoginPty(opts: StartLoginOptions): LoginUiState {
    this.killCurrentPty()
    this.parser.reset()

    const mfaMode: TeleportMfaMode = opts.mfaMode ?? 'auto'
    const username = opts.usernameOverride?.trim() || opts.teleport.username?.trim() || undefined
    const teleport = username ? { ...opts.teleport, username } : opts.teleport
    const args = buildTshLoginArgs(teleport, username, mfaMode)

    this.state = {
      active: true,
      context: opts.contextName,
      reason: opts.reason,
      teleport,
      mfaMode,
      step: 'starting',
      promptText: 'Verbindung mit Teleport wird hergestellt…',
      errorMessage: undefined,
      forceTerminalOpen: Boolean(opts.defaultTerminalOpen)
    }
    this.emitState()

    const env = buildCleanTeleportEnv()

    try {
      const proc = pty.spawn(opts.tshBinaryPath, args, {
        name: 'xterm-256color',
        cols: 92,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env
      })
      this.ptyProc = proc

      proc.onData((chunk) => {
        this.emit('pty-data', chunk)

        const update = this.parser.feed(chunk)
        if (update && this.state) {
          this.state = {
            ...this.state,
            step: update.step,
            promptText: update.promptText,
            errorMessage: update.errorMessage ?? this.state.errorMessage,
            forceTerminalOpen: this.state.forceTerminalOpen || Boolean(update.forceTerminalOpen)
          }
          this.emitState()
        }
      })

      proc.onExit(({ exitCode }) => {
        // Ignore stale exit event if this PTY was already replaced by an identity switch / retry
        if (this.ptyProc !== proc && this.ptyProc !== null) {
          return
        }
        this.ptyProc = null
        if (!this.state) return

        if (exitCode === 0) {
          void this.finalizeSuccessfulLogin({
            ...opts,
            teleport,
            usernameOverride: username,
            mfaMode
          })
        } else {
          this.state = {
            ...this.state,
            active: false,
            step: 'error',
            promptText: 'Anmeldung fehlgeschlagen.',
            errorMessage:
              this.state.errorMessage ||
              `Teleport-Anmeldung beendet (Code ${exitCode}). Bitte Zugangsdaten prüfen.`
          }
          this.emitState()
          this.emit('login-failed', { context: opts.contextName, exitCode })
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.state = {
        ...this.state,
        active: false,
        step: 'error',
        promptText: 'Fehler beim Starten von tsh.',
        errorMessage: msg
      }
      this.emitState()
    }

    return this.state
  }

  /**
   * `tsh login --kube-cluster=<name>` only writes that one Kubernetes context.
   * When `syncAllClusters` is enabled (default), `tsh kube login --all` loads every
   * accessible Kubernetes cluster into `~/.kube/config`.
   */
  private async finalizeSuccessfulLogin(opts: StartLoginOptions): Promise<void> {
    const shouldSyncAll = opts.syncAllClusters ?? true

    if (shouldSyncAll || !opts.teleport.kubeCluster) {
      if (this.state) {
        this.state = {
          ...this.state,
          active: true,
          step: 'syncing_kubeconfig',
          promptText: 'Kubernetes-Cluster werden synchronisiert…',
          errorMessage: undefined
        }
        this.emitState()
      }

      try {
        await execFileAsync(opts.tshBinaryPath, buildTshKubeLoginAllArgs(opts.teleport), {
          timeout: 60000,
          env: buildCleanTeleportEnv()
        })
      } catch (err) {
        console.warn('[tsh-session] tsh kube login --all warning:', err)
      }
    }

    if (this.state) {
      this.state = {
        ...this.state,
        active: false,
        step: 'success',
        promptText: 'Anmeldung erfolgreich abgeschlossen.',
        errorMessage: undefined
      }
      this.emitState()
    }

    this.emit('login-success', {
      context: opts.contextName,
      proxyAddr: opts.teleport.proxyAddr
    })
  }

  /**
   * Syncs kubeconfig entries non-interactively when `tsh` already holds a valid session.
   */
  public async syncKubeClustersNonInteractive(
    tshBinaryPath: string,
    teleport: TeleportMetadata = { isTeleport: true }
  ): Promise<boolean> {
    try {
      await execFileAsync(tshBinaryPath, buildTshKubeLoginAllArgs(teleport), {
        timeout: 60000,
        env: buildCleanTeleportEnv()
      })
      return true
    } catch {
      return false
    }
  }

  public submitFormInput(value: string): void {
    if (!this.ptyProc || !this.state) return
    const submittedUser = this.state.step === 'username' ? value.trim() : ''
    const teleport = submittedUser
      ? { ...this.state.teleport, username: submittedUser }
      : this.state.teleport
    if (submittedUser) {
      this.emit('username-submitted', submittedUser)
    }
    this.parser.clearAfterSubmit()
    this.state = {
      ...this.state,
      teleport,
      step: 'authenticating',
      promptText: 'Anmeldedaten werden geprüft…',
      errorMessage: undefined
    }
    this.emitState()
    const lineEnding = process.platform === 'win32' ? '\r' : '\n'
    this.ptyProc.write(`${value}${lineEnding}`)
  }

  public writeRawPty(data: string): void {
    if (!this.ptyProc) return
    this.ptyProc.write(data)
  }

  public resizePty(cols: number, rows: number): void {
    if (!this.ptyProc || cols <= 0 || rows <= 0) return
    try {
      this.ptyProc.resize(cols, rows)
    } catch {
      // Ignore resize race on exit
    }
  }

  public cancel(): void {
    const ctx = this.state?.context
    this.killCurrentPty()
    this.state = null
    this.emitState()
    if (ctx) {
      this.emit('login-cancelled', { context: ctx })
    }
  }

  public dispose(): void {
    this.killCurrentPty()
    this.state = null
  }

  private killCurrentPty(): void {
    if (!this.ptyProc) return
    const proc = this.ptyProc
    this.ptyProc = null
    try {
      proc.kill()
    } catch {
      // already exited
    }
  }

  private emitState(): void {
    this.emit('state-changed', this.state)
  }
}

function buildCleanTeleportEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') {
      env[k] = v
    }
  }
  env.BROWSER = 'none'
  env.TELEPORT_ADD_KEYS_TO_AGENT = 'no'
  env.TERM = 'xterm-256color'
  return env
}

export function buildTshLoginArgs(
  teleport: TeleportMetadata,
  usernameOverride?: string,
  mfaMode: TeleportMfaMode = 'auto'
): string[] {
  const args: string[] = []

  if (teleport.proxyAddr) {
    args.push(`--proxy=${teleport.proxyAddr}`)
  }
  const username = (usernameOverride || teleport.username || '').trim()
  if (username) {
    args.push(`--user=${username}`)
  }
  if (mfaMode && mfaMode !== 'auto') {
    args.push(`--mfa-mode=${mfaMode}`)
  }

  // `tsh login` supports `--browser=none` and `--kube-cluster=<name>`,
  // authenticating the Teleport session AND issuing Kubernetes credentials in-app.
  args.push('login', '--browser=none')

  if (teleport.kubeCluster) {
    args.push(`--kube-cluster=${teleport.kubeCluster}`)
  }
  if (teleport.teleportCluster) {
    args.push(teleport.teleportCluster)
  }

  return args
}

/** Writes every Kubernetes cluster the logged-in user may access into the kubeconfig. */
export function buildTshKubeLoginAllArgs(teleport: TeleportMetadata): string[] {
  const args: string[] = []
  if (teleport.proxyAddr) {
    args.push(`--proxy=${teleport.proxyAddr}`)
  }
  const username = teleport.username?.trim()
  if (username) {
    args.push(`--user=${username}`)
  }
  args.push('kube', 'login', '--all')
  if (teleport.teleportCluster) {
    args.push(`--cluster=${teleport.teleportCluster}`)
  }
  return args
}
