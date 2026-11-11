import { app, dialog, ipcMain, Menu, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppStatusState,
  BinarySettings,
  ContextSummary,
  ProxyAuthRequiredEvent,
  ProxyOutboundEvent,
  SaveSettingsPayload,
  TeleportMetadata,
  TeleportMfaMode
} from '@shared/types'
import {
  computeCaptainPreferences,
  enrichProcessEnvFromLoginShell,
  isExecutableFile,
  loadPersistedSettings,
  PersistedSettings,
  resolveBundledProxyBinary,
  resolveRadarBinary,
  resolveTshBinary,
  savePersistedSettings
} from './env'
import { ProxyManager } from './processes/proxy-manager'
import { RadarManager } from './processes/radar-manager'
import { KubeconfigWatcher } from './kubeconfig-watcher'
import { TshSessionManager } from './teleport/tsh-session'
import { inspectTshStatusOnce } from './teleport/tsh-status'
import { resolveTeleportUsername } from './teleport/teleport-user'
import { WindowComposer } from './window'

app.setName('Captain')

let winComposer: WindowComposer | null = null
let proxyManager: ProxyManager | null = null
let radarManager: RadarManager | null = null
const kubeconfigWatcher = new KubeconfigWatcher()
const tshSession = new TshSessionManager()

let persistedSettings: PersistedSettings = {}
let lastStatusUser: string | undefined
let lastAuthRequest: ProxyAuthRequiredEvent | null = null
let knownContexts: ContextSummary[] = []
let isQuitting = false

let appState: AppStatusState = {
  phase: 'starting',
  radarUrl: null,
  currentContext: '',
  binaries: {
    radarPath: '',
    tshPath: '',
    resolvedRadarPath: null,
    resolvedTshPath: null,
    kubeconfigEnv: ''
  },
  preferences: computeCaptainPreferences({}),
  login: null,
  settingsOpen: false
}

function computeBinarySettings(): BinarySettings {
  return {
    radarPath: persistedSettings.radarPath || '',
    tshPath: persistedSettings.tshPath || '',
    resolvedRadarPath: resolveRadarBinary(persistedSettings.radarPath),
    resolvedTshPath: resolveTshBinary(persistedSettings.tshPath),
    kubeconfigEnv: process.env.KUBECONFIG || '~/.kube/config'
  }
}

function contextNameKey(contexts: ContextSummary[]): string {
  return contexts
    .map((context) => context.name)
    .sort()
    .join('\0')
}

function cleanProxyAddress(raw?: string): string | undefined {
  if (!raw) return undefined
  const clean = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return clean || undefined
}

function defaultProxyHint(): string | undefined {
  return cleanProxyAddress(persistedSettings.lastTeleportProxy || process.env.TELEPORT_PROXY)
}

function rememberTeleportUser(user: string | undefined): void {
  const clean = user?.trim()
  if (!clean || clean === persistedSettings.lastTeleportUser) return
  persistedSettings = { ...persistedSettings, lastTeleportUser: clean }
  savePersistedSettings(app.getPath('userData'), persistedSettings)
}

function attachTeleportUser(teleport: TeleportMetadata, explicit?: string): TeleportMetadata {
  const username = resolveTeleportUsername({
    explicit,
    proxyAddr: teleport.proxyAddr,
    persistedUser: persistedSettings.lastTeleportUser,
    statusUser: lastStatusUser,
    envUser: process.env.TELEPORT_USER
  })
  if (username) rememberTeleportUser(username)
  return username ? { ...teleport, username } : teleport
}

function shouldShowOverlay(state: AppStatusState): boolean {
  if (state.settingsOpen) return true
  if (
    state.phase === 'starting' ||
    state.phase === 'missing_binaries' ||
    state.phase === 'fatal_error'
  ) {
    return true
  }
  if (state.phase === 'auth_required' && state.login !== null) {
    return true
  }
  return false
}

function publishState(patch: Partial<AppStatusState>): void {
  appState = {
    ...appState,
    ...patch,
    binaries: patch.binaries ?? computeBinarySettings(),
    preferences: patch.preferences ?? computeCaptainPreferences(persistedSettings)
  }

  if (winComposer && !winComposer.baseWindow.isDestroyed()) {
    const visible = shouldShowOverlay(appState)
    winComposer.setOverlayVisible(visible)
    winComposer.overlayView.webContents.send('launcher:state-changed', appState)
  }
}

function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Captain',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Einstellungen…',
                accelerator: 'CmdOrCtrl+,',
                click: () => publishState({ settingsOpen: true })
              },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Verbindung',
      submenu: [
        {
          label: 'Bei Teleport anmelden…',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => triggerManualTeleportLogin()
        },
        {
          label: 'Cluster-Verbindung erneuern',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: async () => {
            proxyManager?.sendCommand({ type: 'proxy:reload' })
            proxyManager?.sendCommand({ type: 'auth:completed', context: appState.currentContext })
            await radarManager?.triggerConnectionRetry()
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Einstellungen…',
                accelerator: 'CmdOrCtrl+,',
                click: () => publishState({ settingsOpen: true })
              },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          : [])
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        {
          label: 'Arbeitsbereich neu laden',
          accelerator: 'CmdOrCtrl+R',
          click: () => winComposer?.radarView.webContents.reload()
        },
        {
          label: 'Entwicklerwerkzeuge (Cluster-Ansicht)',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => winComposer?.radarView.webContents.toggleDevTools()
        },
        {
          label: 'Entwicklerwerkzeuge (Captain UI)',
          click: () => winComposer?.overlayView.webContents.toggleDevTools()
        },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function triggerManualTeleportLogin(): void {
  const bins = computeBinarySettings()
  if (!bins.resolvedTshPath) {
    publishState({
      settingsOpen: true,
      errorMessage: 'Das `tsh` CLI wurde nicht gefunden. Bitte Pfad in den Einstellungen prüfen.'
    })
    return
  }

  const activeSummary =
    knownContexts.find((c) => c.name === appState.currentContext && c.teleport.isTeleport) ??
    knownContexts.find((c) => c.teleport.isTeleport)

  const evt: ProxyAuthRequiredEvent = lastAuthRequest ?? {
    type: 'auth:required',
    context: activeSummary?.name || 'Teleport',
    reason: 'Manuelle Teleport-Anmeldung',
    teleport: activeSummary?.teleport || {
      isTeleport: true,
      proxyAddr: defaultProxyHint()
    }
  }

  handleAuthRequired(evt)
}

function handleAuthRequired(evt: ProxyAuthRequiredEvent): void {
  const prefs = computeCaptainPreferences(persistedSettings)
  const enrichedEvt: ProxyAuthRequiredEvent = {
    ...evt,
    teleport: attachTeleportUser({
      ...evt.teleport,
      isTeleport: true,
      proxyAddr: evt.teleport.proxyAddr || defaultProxyHint()
    })
  }
  lastAuthRequest = enrichedEvt
  const bins = computeBinarySettings()

  if (!bins.resolvedTshPath) {
    publishState({
      phase: 'missing_binaries',
      errorMessage:
        'Teleport-Anmeldung erforderlich, aber `tsh` wurde nicht im System-PATH gefunden.'
    })
    return
  }

  if (tshSession.isActive()) {
    publishState({
      phase: 'auth_required',
      currentContext: enrichedEvt.context,
      login: tshSession.getState()
    })
    return
  }

  const loginState = tshSession.startLogin({
    tshBinaryPath: bins.resolvedTshPath,
    contextName: enrichedEvt.context,
    reason: enrichedEvt.reason,
    teleport: enrichedEvt.teleport,
    mfaMode: prefs.mfaMode,
    syncAllClusters: prefs.syncAllClusters,
    defaultTerminalOpen: prefs.showTerminalByDefault
  })

  publishState({
    phase: 'auth_required',
    currentContext: enrichedEvt.context,
    login: loginState
  })
}

async function waitForProxyContextsRefresh(timeoutMs = 1500): Promise<ContextSummary[]> {
  if (!proxyManager) return knownContexts
  return new Promise<ContextSummary[]>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        proxyManager?.removeListener('event', onEvt)
        resolve(knownContexts)
      }
    }, timeoutMs)

    const onEvt = (evt: ProxyOutboundEvent): void => {
      if (evt.type === 'proxy:contexts_updated') {
        if (!done) {
          done = true
          clearTimeout(timer)
          proxyManager?.removeListener('event', onEvt)
          resolve(evt.contexts)
        }
      }
    }

    proxyManager.on('event', onEvt)
    proxyManager.sendCommand({ type: 'proxy:reload' })
  })
}

async function bootstrapBackend(): Promise<void> {
  const bins = computeBinarySettings()
  const prefs = computeCaptainPreferences(persistedSettings)

  if (!bins.resolvedRadarPath) {
    publishState({
      phase: 'missing_binaries',
      binaries: bins,
      errorMessage: 'Das Kubernetes-Backend (`radar` / `kubectl-radar`) wurde nicht im PATH gefunden.'
    })
    return
  }

  const proxyBin = resolveBundledProxyBinary(
    app.isPackaged,
    process.resourcesPath,
    app.getAppPath()
  )
  if (!isExecutableFile(proxyBin)) {
    publishState({
      phase: 'fatal_error',
      binaries: bins,
      errorMessage: `Lokaler Kubernetes-Proxy nicht gefunden unter: ${proxyBin}`
    })
    return
  }

  publishState({
    phase: 'starting',
    binaries: bins,
    errorMessage: undefined
  })

  try {
    await radarManager?.stop()
    await proxyManager?.stop()

    proxyManager = new ProxyManager(proxyBin)
    proxyManager.on('event', (evt: ProxyOutboundEvent) => {
      if (evt.type === 'auth:required') {
        handleAuthRequired(evt)
      } else if (evt.type === 'proxy:contexts_updated') {
        const previousNames = contextNameKey(knownContexts)
        knownContexts = evt.contexts
        if (!appState.currentContext && evt.currentContext) {
          publishState({ currentContext: evt.currentContext })
        }
        // Reload workspace view when newly discovered clusters appear in kubeconfig
        if (
          previousNames &&
          previousNames !== contextNameKey(knownContexts) &&
          appState.radarUrl &&
          winComposer &&
          !winComposer.radarView.webContents.isDestroyed()
        ) {
          winComposer.radarView.webContents.reload()
        }
      } else if (evt.type === 'proxy:diagnostic') {
        console.log(
          `[proxy-diag] ctx=${evt.context} category=${evt.category} status=${evt.statusCode ?? '-'} detail=${evt.detail}`
        )
      }
    })
    proxyManager.on('unexpected-exit', ({ code, signal }) => {
      if (isQuitting) return
      publishState({
        phase: 'fatal_error',
        errorMessage: `Lokaler Kubernetes-Proxy unerwartet beendet (Code: ${code}, Signal: ${signal}).`
      })
    })

    const ready = await proxyManager.start()
    knownContexts = ready.contexts

    kubeconfigWatcher.start(() => {
      proxyManager?.sendCommand({ type: 'proxy:reload' })
    })

    // Refresh accessible Teleport Kubernetes clusters on startup when a valid session exists
    const tshSnapshot = bins.resolvedTshPath
      ? await inspectTshStatusOnce(bins.resolvedTshPath)
      : null
    if (tshSnapshot?.username) {
      lastStatusUser = tshSnapshot.username
      rememberTeleportUser(tshSnapshot.username)
    }
    if (bins.resolvedTshPath && tshSnapshot?.loggedIn && prefs.syncAllClusters) {
      const synced = await tshSession.syncKubeClustersNonInteractive(bins.resolvedTshPath, {
        isTeleport: true,
        proxyAddr: tshSnapshot.proxyAddr,
        teleportCluster: tshSnapshot.teleportCluster,
        username: tshSnapshot.username || persistedSettings.lastTeleportUser
      })
      if (synced) {
        knownContexts = await waitForProxyContextsRefresh(2000)
      }
    }

    radarManager = new RadarManager()
    radarManager.on('unexpected-exit', ({ code, signal }) => {
      if (isQuitting) return
      publishState({
        phase: 'fatal_error',
        errorMessage: `Lokaler Cluster-Dienst unerwartet beendet (Code: ${code}, Signal: ${signal}).`
      })
    })

    const radarUrl = await radarManager.start(bins.resolvedRadarPath, ready.syntheticKubeconfig)
    await winComposer?.loadRadarUrl(radarUrl)

    if (
      bins.resolvedTshPath &&
      !tshSession.isActive() &&
      tshSnapshot &&
      !tshSnapshot.loggedIn &&
      !knownContexts.some((c) => c.teleport.isTeleport)
    ) {
      handleAuthRequired({
        type: 'auth:required',
        context: 'Teleport',
        reason: 'Keine aktive Teleport-Sitzung gefunden. Bitte melden Sie sich an.',
        teleport: {
          isTeleport: true,
          proxyAddr: tshSnapshot.proxyAddr || defaultProxyHint(),
          teleportCluster: tshSnapshot.teleportCluster,
          username: tshSnapshot.username
        }
      })
      publishState({ radarUrl })
      return
    }

    const currentLogin = tshSession.getState()
    const nextPhase = currentLogin && currentLogin.active ? 'auth_required' : 'ready'

    publishState({
      phase: nextPhase,
      radarUrl,
      currentContext: ready.currentContext,
      login: nextPhase === 'auth_required' ? currentLogin : appState.login
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    publishState({
      phase: 'fatal_error',
      errorMessage: msg
    })
  }
}

function wireTshEvents(): void {
  tshSession.on('pty-data', (chunk: string) => {
    if (winComposer && !winComposer.baseWindow.isDestroyed()) {
      winComposer.overlayView.webContents.send('launcher:pty-data', chunk)
    }
  })

  tshSession.on('state-changed', (loginState) => {
    if (!loginState) {
      publishState({
        phase: appState.radarUrl ? 'ready' : 'starting',
        login: null
      })
      return
    }
    publishState({
      phase: 'auth_required',
      login: loginState
    })
  })

  tshSession.on(
    'login-success',
    async ({ context, proxyAddr }: { context: string; proxyAddr?: string }) => {
      if (proxyAddr && proxyAddr !== persistedSettings.lastTeleportProxy) {
        persistedSettings = { ...persistedSettings, lastTeleportProxy: proxyAddr }
        savePersistedSettings(app.getPath('userData'), persistedSettings)
      }
      rememberTeleportUser(tshSession.getState()?.teleport.username)

      const updatedContexts = await waitForProxyContextsRefresh(2000)
      proxyManager?.sendCommand({ type: 'auth:completed', context })

      const prefs = computeCaptainPreferences(persistedSettings)
      const activeCtxSummary = updatedContexts.find((c) => c.name === appState.currentContext)
      const firstTeleportCtx = updatedContexts.find((c) => c.teleport.isTeleport)

      if (
        prefs.autoSelectTeleportCluster &&
        (!activeCtxSummary || !activeCtxSummary.teleport.isTeleport) &&
        firstTeleportCtx
      ) {
        const switched = await radarManager?.switchContext(firstTeleportCtx.name)
        if (switched) {
          appState.currentContext = firstTeleportCtx.name
          winComposer?.radarView.webContents.reload()
        } else {
          await radarManager?.triggerConnectionRetry()
        }
      } else {
        await radarManager?.triggerConnectionRetry()
      }

      setTimeout(() => {
        if (!tshSession.isActive()) {
          publishState({
            phase: 'ready',
            currentContext: appState.currentContext,
            login: null
          })
        }
      }, 450)
    }
  )

  tshSession.on('username-submitted', (username: string) => {
    rememberTeleportUser(username)
    if (lastAuthRequest) {
      lastAuthRequest = {
        ...lastAuthRequest,
        teleport: { ...lastAuthRequest.teleport, username }
      }
    }
  })

  tshSession.on('login-cancelled', ({ context }: { context: string }) => {
    proxyManager?.sendCommand({ type: 'auth:cancelled', context })
    publishState({
      phase: appState.radarUrl ? 'ready' : 'starting',
      login: null
    })
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle('launcher:get-state', () => appState)

  ipcMain.handle('launcher:open-settings', () => {
    publishState({ settingsOpen: true })
  })

  ipcMain.handle(
    'launcher:submit-proxy-config',
    (
      _evt,
      payload: { proxyAddr: string; usernameOverride?: string; mfaMode?: TeleportMfaMode }
    ) => {
      const cleanProxy = cleanProxyAddress(payload.proxyAddr) || ''
      const knownTeleport = lastAuthRequest?.teleport || { isTeleport: true as const }
      const teleport = attachTeleportUser(
        { ...knownTeleport, isTeleport: true, proxyAddr: cleanProxy || knownTeleport.proxyAddr },
        payload.usernameOverride
      )
      if (cleanProxy && cleanProxy !== persistedSettings.lastTeleportProxy) {
        persistedSettings = { ...persistedSettings, lastTeleportProxy: cleanProxy }
        savePersistedSettings(app.getPath('userData'), persistedSettings)
      }
      if (payload.mfaMode && payload.mfaMode !== persistedSettings.mfaMode) {
        persistedSettings = { ...persistedSettings, mfaMode: payload.mfaMode }
        savePersistedSettings(app.getPath('userData'), persistedSettings)
      }
      if (lastAuthRequest) {
        lastAuthRequest = { ...lastAuthRequest, teleport }
      }
      tshSession.submitProxyConfig(
        cleanProxy,
        teleport.username,
        payload.mfaMode ?? computeCaptainPreferences(persistedSettings).mfaMode
      )
    }
  )

  ipcMain.handle('launcher:submit-auth-input', (_evt, value: string) => {
    tshSession.submitFormInput(value)
  })

  ipcMain.on('launcher:pty-write', (_evt, data: string) => {
    tshSession.writeRawPty(data)
  })

  ipcMain.on('launcher:pty-resize', (_evt, cols: number, rows: number) => {
    tshSession.resizePty(cols, rows)
  })

  ipcMain.handle(
    'launcher:retry-auth',
    (
      _evt,
      payload?: {
        usernameOverride?: string
        proxyAddrOverride?: string
        mfaMode?: TeleportMfaMode
      }
    ) => {
      const bins = computeBinarySettings()
      if (!bins.resolvedTshPath) return

      const baseReq: ProxyAuthRequiredEvent = lastAuthRequest ?? {
        type: 'auth:required',
        context: appState.login?.context || 'Teleport',
        reason: appState.login?.reason || 'Teleport-Anmeldung',
        teleport: appState.login?.teleport || {
          isTeleport: true,
          proxyAddr: defaultProxyHint()
        }
      }

      const nextProxy = cleanProxyAddress(payload?.proxyAddrOverride) || baseReq.teleport.proxyAddr
      if (nextProxy && nextProxy !== persistedSettings.lastTeleportProxy) {
        persistedSettings = { ...persistedSettings, lastTeleportProxy: nextProxy }
        savePersistedSettings(app.getPath('userData'), persistedSettings)
      }
      if (payload?.mfaMode && payload.mfaMode !== persistedSettings.mfaMode) {
        persistedSettings = { ...persistedSettings, mfaMode: payload.mfaMode }
        savePersistedSettings(app.getPath('userData'), persistedSettings)
      }

      const prefs = computeCaptainPreferences(persistedSettings)
      const teleport = attachTeleportUser(
        { ...baseReq.teleport, isTeleport: true, proxyAddr: nextProxy },
        payload?.usernameOverride
      )
      lastAuthRequest = { ...baseReq, teleport }

      const loginState = tshSession.startLogin({
        tshBinaryPath: bins.resolvedTshPath,
        contextName: lastAuthRequest.context,
        reason: lastAuthRequest.reason,
        teleport,
        usernameOverride: teleport.username,
        mfaMode: payload?.mfaMode ?? prefs.mfaMode,
        syncAllClusters: prefs.syncAllClusters,
        defaultTerminalOpen: prefs.showTerminalByDefault
      })
      publishState({
        phase: 'auth_required',
        login: loginState
      })
    }
  )

  ipcMain.handle('launcher:cancel-auth', () => {
    tshSession.cancel()
  })

  ipcMain.handle('launcher:clear-saved-identity', () => {
    persistedSettings = {
      ...persistedSettings,
      lastTeleportProxy: undefined,
      lastTeleportUser: undefined
    }
    savePersistedSettings(app.getPath('userData'), persistedSettings)
    publishState({
      preferences: computeCaptainPreferences(persistedSettings)
    })
  })

  ipcMain.handle('launcher:save-settings', async (_evt, payload: SaveSettingsPayload) => {
    const cleanProxy = cleanProxyAddress(payload.preferences?.defaultTeleportProxy)
    const cleanUser = payload.preferences?.defaultTeleportUser?.trim() || undefined

    const prevProxy = persistedSettings.lastTeleportProxy
    const prevUser = persistedSettings.lastTeleportUser
    const prevMfa = persistedSettings.mfaMode ?? 'auto'

    persistedSettings = {
      ...persistedSettings,
      radarPath: payload.radarPath.trim() || undefined,
      tshPath: payload.tshPath.trim() || undefined,
      lastTeleportProxy: cleanProxy,
      lastTeleportUser: cleanUser,
      mfaMode: payload.preferences?.mfaMode ?? 'auto',
      syncAllClusters: payload.preferences?.syncAllClusters ?? true,
      autoSelectTeleportCluster: payload.preferences?.autoSelectTeleportCluster ?? true,
      showTerminalByDefault: payload.preferences?.showTerminalByDefault ?? false
    }
    savePersistedSettings(app.getPath('userData'), persistedSettings)

    const nextBins = computeBinarySettings()
    const nextPrefs = computeCaptainPreferences(persistedSettings)

    publishState({
      settingsOpen: false,
      binaries: nextBins,
      preferences: nextPrefs
    })

    if (
      !appState.radarUrl ||
      appState.phase === 'missing_binaries' ||
      appState.phase === 'fatal_error'
    ) {
      await bootstrapBackend()
      return
    }

    // If a login prompt is currently waiting and the user changed identity/proxy/MFA in Captain settings,
    // restart the login session cleanly with the updated parameters.
    const identityChanged =
      cleanProxy !== prevProxy || cleanUser !== prevUser || nextPrefs.mfaMode !== prevMfa
    if (identityChanged && appState.phase === 'auth_required' && nextBins.resolvedTshPath) {
      const baseReq = lastAuthRequest ?? {
        type: 'auth:required' as const,
        context: appState.login?.context || 'Teleport',
        reason: appState.login?.reason || 'Teleport-Anmeldung',
        teleport: { isTeleport: true }
      }
      const teleport = attachTeleportUser(
        {
          ...baseReq.teleport,
          isTeleport: true,
          proxyAddr: cleanProxy || baseReq.teleport.proxyAddr
        },
        cleanUser
      )
      lastAuthRequest = { ...baseReq, teleport }
      const loginState = tshSession.startLogin({
        tshBinaryPath: nextBins.resolvedTshPath,
        contextName: lastAuthRequest.context,
        reason: lastAuthRequest.reason,
        teleport,
        usernameOverride: teleport.username,
        mfaMode: nextPrefs.mfaMode,
        syncAllClusters: nextPrefs.syncAllClusters,
        defaultTerminalOpen: nextPrefs.showTerminalByDefault
      })
      publishState({
        phase: 'auth_required',
        login: loginState
      })
    }
  })

  ipcMain.handle('launcher:pick-binary', async (_evt, title: string) => {
    const res = await dialog.showOpenDialog({
      title,
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle('launcher:close-settings', () => {
    publishState({ settingsOpen: false })
  })

  ipcMain.handle('launcher:restart-backend', async () => {
    await bootstrapBackend()
  })
}

async function shutdownAllProcesses(): Promise<void> {
  isQuitting = true
  kubeconfigWatcher.stop()
  tshSession.dispose()
  await Promise.allSettled([radarManager?.stop(), proxyManager?.stop()])
}

function resolveRuntimeIconPath(): string | undefined {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(candidate) ? candidate : undefined
}

app.whenReady().then(async () => {
  enrichProcessEnvFromLoginShell()
  persistedSettings = loadPersistedSettings(app.getPath('userData'))
  appState.binaries = computeBinarySettings()
  appState.preferences = computeCaptainPreferences(persistedSettings)

  const iconPath = resolveRuntimeIconPath()
  if (process.platform === 'darwin' && iconPath && app.dock) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath))
    } catch {
      // ignore dock icon error
    }
  }

  wireTshEvents()
  registerIpcHandlers()
  setupApplicationMenu()

  const preloadCjs = join(__dirname, '../preload/index.js')
  const preloadMjs = join(__dirname, '../preload/index.mjs')
  const preloadPath = existsSync(preloadCjs) ? preloadCjs : preloadMjs
  winComposer = new WindowComposer(preloadPath, iconPath)
  await winComposer.loadOverlayUI()

  await bootstrapBackend()
})

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault()
    shutdownAllProcesses().finally(() => {
      app.exit(0)
    })
  }
})

app.on('window-all-closed', () => {
  shutdownAllProcesses().finally(() => {
    app.quit()
  })
})
