import {
  app,
  dialog,
  Event as ElectronEvent,
  Input,
  ipcMain,
  Menu,
  nativeImage
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildWorkspaceViewRef } from '@shared/radar-route'
import {
  matchesElectronInput,
  matchPaletteSlotInput,
  normalizeShortcutBindings
} from '@shared/shortcuts'
import type {
  AppStatusState,
  BinarySettings,
  ContextSummary,
  ProxyAuthRequiredEvent,
  ProxyOutboundEvent,
  SaveSettingsPayload,
  TeleportMetadata,
  TeleportMfaMode,
  WorkspaceOverlayMode,
  WorkspaceViewRef
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
import { RadarLocationSnapshot, WindowComposer } from './window'
import { WorkspaceStore } from './workspace-store'

app.setName('Captain')

let winComposer: WindowComposer | null = null
let proxyManager: ProxyManager | null = null
let radarManager: RadarManager | null = null
const kubeconfigWatcher = new KubeconfigWatcher()
const tshSession = new TshSessionManager()
const workspaceStore = new WorkspaceStore()

let persistedSettings: PersistedSettings = {}
let lastStatusUser: string | undefined
let lastAuthRequest: ProxyAuthRequiredEvent | null = null
let knownContexts: ContextSummary[] = []
let workspaceOverlayMode: WorkspaceOverlayMode = 'closed'
let latestRadarLocation: RadarLocationSnapshot = { routePath: '/', pageTitle: '' }
let isQuitting = false

const lastShortcutTriggerAt = new Map<string, number>()

let appState: AppStatusState = {
  phase: 'starting',
  radarUrl: null,
  currentContext: '',
  contexts: [],
  binaries: {
    radarPath: '',
    tshPath: '',
    resolvedRadarPath: null,
    resolvedTshPath: null,
    kubeconfigEnv: ''
  },
  preferences: computeCaptainPreferences({}),
  workspace: workspaceStore.getSnapshot('closed', null),
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

function computeLiveWorkspaceView(contextOverride?: string): WorkspaceViewRef | null {
  const ctx = contextOverride ?? appState.currentContext
  if (!ctx && knownContexts.length === 0) return null
  const effectiveContext = ctx || knownContexts[0]?.name || ''
  if (!effectiveContext) return null

  const loc = winComposer ? winComposer.getCurrentRadarLocation() : latestRadarLocation
  if (loc.routePath) {
    latestRadarLocation = loc
  }

  return buildWorkspaceViewRef({
    id: 'live-workspace-view',
    context: effectiveContext,
    contexts: knownContexts,
    rawUrlOrPath: latestRadarLocation.routePath || '/',
    pageTitle: latestRadarLocation.pageTitle
  })
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
  if (state.phase === 'ready' && state.workspace.overlayMode !== 'closed') {
    return true
  }
  return false
}

function shouldBlurRadarBehindOverlay(state: AppStatusState): boolean {
  if (!state.preferences.blurRadarBackdrop) return false
  if (!state.radarUrl) return false
  if (
    state.phase === 'starting' ||
    state.phase === 'missing_binaries' ||
    state.phase === 'fatal_error'
  ) {
    return false
  }
  return shouldShowOverlay(state)
}

function publishState(patch: Partial<AppStatusState>): void {
  const nextContext = patch.currentContext ?? appState.currentContext
  const liveView = computeLiveWorkspaceView(nextContext)

  appState = {
    ...appState,
    ...patch,
    contexts: patch.contexts ?? knownContexts,
    binaries: patch.binaries ?? computeBinarySettings(),
    preferences: patch.preferences ?? computeCaptainPreferences(persistedSettings),
    workspace:
      patch.workspace ?? workspaceStore.getSnapshot(workspaceOverlayMode, liveView)
  }

  if (winComposer && !winComposer.baseWindow.isDestroyed()) {
    const visible = shouldShowOverlay(appState)
    const blurRadar = shouldBlurRadarBehindOverlay(appState)
    winComposer.setOverlayState(visible, blurRadar)
    winComposer.overlayView.webContents.send('launcher:state-changed', appState)
  }
}

function guardActionDebounce(actionKey: string, cooldownMs = 90): boolean {
  const now = Date.now()
  const prev = lastShortcutTriggerAt.get(actionKey) ?? 0
  if (now - prev < cooldownMs) return false
  lastShortcutTriggerAt.set(actionKey, now)
  return true
}

async function setOverlayModeWithSync(nextMode: WorkspaceOverlayMode): Promise<void> {
  if (nextMode !== 'closed' && appState.phase !== 'ready') {
    return
  }

  workspaceOverlayMode = nextMode
  if (nextMode !== 'closed') {
    const radarActiveCtx = await radarManager?.getActiveContext()
    if (radarActiveCtx && radarActiveCtx !== appState.currentContext) {
      appState.currentContext = radarActiveCtx
    }
  }

  publishState({
    settingsOpen: nextMode !== 'closed' ? false : appState.settingsOpen
  })
}

function toggleSettingsOverlay(): void {
  if (!guardActionDebounce('openSettings')) return
  if (appState.settingsOpen) {
    if (appState.phase !== 'missing_binaries') {
      publishState({ settingsOpen: false })
    }
    return
  }
  workspaceOverlayMode = 'closed'
  publishState({ settingsOpen: true })
}

function togglePaletteOverlay(): void {
  if (!guardActionDebounce('palette')) return
  if (appState.phase !== 'ready') return
  const next: WorkspaceOverlayMode =
    !appState.settingsOpen && workspaceOverlayMode === 'palette' ? 'closed' : 'palette'
  void setOverlayModeWithSync(next)
}

async function reconnectActiveCluster(): Promise<void> {
  if (!guardActionDebounce('reconnectCluster')) return
  proxyManager?.sendCommand({ type: 'proxy:reload' })
  proxyManager?.sendCommand({ type: 'auth:completed', context: appState.currentContext })
  await radarManager?.triggerConnectionRetry()
}

async function navigateToWorkspaceView(
  view: WorkspaceViewRef,
  options?: { removeFromSlot?: { paletteId: string; slotIndex: number } }
): Promise<boolean> {
  if (options?.removeFromSlot) {
    workspaceStore.removeSlotView(
      options.removeFromSlot.paletteId,
      options.removeFromSlot.slotIndex
    )
  }

  workspaceOverlayMode = 'closed'
  const targetContext = view.context || appState.currentContext
  const needsContextSwitch = Boolean(targetContext && targetContext !== appState.currentContext)

  publishState({
    currentContext: targetContext || appState.currentContext
  })

  if (needsContextSwitch && radarManager) {
    const switched = await radarManager.switchContext(targetContext)
    if (!switched) {
      return false
    }
    await new Promise((r) => setTimeout(r, 65))
  }

  await winComposer?.navigateRadarToPath(view.routePath || '/')
  publishState({
    currentContext: targetContext || appState.currentContext
  })
  return true
}

function handleGlobalWindowShortcut(event: ElectronEvent, input: Input): void {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return
  const prefs = computeCaptainPreferences(persistedSettings)
  const { shortcuts } = prefs

  if (matchesElectronInput(input, shortcuts.openSettings)) {
    event.preventDefault()
    toggleSettingsOverlay()
    return
  }

  if (matchesElectronInput(input, shortcuts.paletteMenu)) {
    if (appState.phase === 'ready') {
      event.preventDefault()
      togglePaletteOverlay()
    }
    return
  }

  if (matchesElectronInput(input, shortcuts.teleportLogin)) {
    event.preventDefault()
    if (guardActionDebounce('teleportLogin')) {
      triggerManualTeleportLogin()
    }
    return
  }

  if (matchesElectronInput(input, shortcuts.reconnectCluster)) {
    event.preventDefault()
    void reconnectActiveCluster()
    return
  }

  if (prefs.enableSlotShortcuts && appState.phase === 'ready' && !appState.settingsOpen) {
    const slotIdx = matchPaletteSlotInput(input)
    if (slotIdx !== null) {
      const slotView = workspaceStore.getActivePalette().slots[slotIdx]
      if (slotView) {
        event.preventDefault()
        if (guardActionDebounce(`slot:${slotIdx}`)) {
          void navigateToWorkspaceView(slotView)
        }
      }
    }
  }
}

function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const prefs = computeCaptainPreferences(persistedSettings)
  const { shortcuts } = prefs

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
                accelerator: shortcuts.openSettings,
                click: () => toggleSettingsOverlay()
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
          label: 'Ansichts-Paletten…',
          accelerator: shortcuts.paletteMenu,
          click: () => togglePaletteOverlay()
        },
        { type: 'separator' as const },
        {
          label: 'Bei Teleport anmelden…',
          accelerator: shortcuts.teleportLogin,
          click: () => {
            if (guardActionDebounce('teleportLogin')) {
              triggerManualTeleportLogin()
            }
          }
        },
        {
          label: 'Cluster-Verbindung erneuern',
          accelerator: shortcuts.reconnectCluster,
          click: () => {
            void reconnectActiveCluster()
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Einstellungen…',
                accelerator: shortcuts.openSettings,
                click: () => toggleSettingsOverlay()
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

  workspaceOverlayMode = 'closed'

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
  workspaceOverlayMode = 'closed'
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
  const pm = proxyManager
  if (!pm) return knownContexts
  return new Promise<ContextSummary[]>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        pm.removeListener('event', onEvt)
        resolve(knownContexts)
      }
    }, timeoutMs)

    const onEvt = (evt: ProxyOutboundEvent): void => {
      if (evt.type === 'proxy:contexts_updated') {
        if (!done) {
          done = true
          clearTimeout(timer)
          pm.removeListener('event', onEvt)
          resolve(evt.contexts)
        }
      }
    }

    pm.on('event', onEvt)
    pm.sendCommand({ type: 'proxy:reload' })
  })
}

async function bootstrapBackend(): Promise<void> {
  const bins = computeBinarySettings()
  const prefs = computeCaptainPreferences(persistedSettings)

  if (!bins.resolvedRadarPath) {
    publishState({
      phase: 'missing_binaries',
      binaries: bins,
      errorMessage:
        'Das Kubernetes-Backend (`radar` / `kubectl-radar`) wurde nicht im PATH gefunden.'
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
        workspaceStore.syncContextDisplayMetadata(knownContexts)
        publishState({
          contexts: knownContexts,
          currentContext: appState.currentContext || evt.currentContext
        })
        if (
          previousNames &&
          previousNames !== contextNameKey(knownContexts) &&
          appState.radarUrl &&
          winComposer &&
          !winComposer.radarView.webContents.isDestroyed()
        ) {
          winComposer.radarView.webContents.reload()
        }
      } else if (evt.type === 'proxy:active_context') {
        if (evt.context && evt.context !== appState.currentContext) {
          publishState({ currentContext: evt.context })
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
    workspaceStore.syncContextDisplayMetadata(knownContexts)

    kubeconfigWatcher.start(() => {
      proxyManager?.sendCommand({ type: 'proxy:reload' })
    })

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
        workspaceStore.syncContextDisplayMetadata(knownContexts)
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
      publishState({ radarUrl, contexts: knownContexts })
      return
    }

    const currentLogin = tshSession.getState()
    const nextPhase = currentLogin && currentLogin.active ? 'auth_required' : 'ready'

    publishState({
      phase: nextPhase,
      radarUrl,
      currentContext: ready.currentContext,
      contexts: knownContexts,
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
      knownContexts = updatedContexts
      workspaceStore.syncContextDisplayMetadata(knownContexts)
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
            contexts: knownContexts,
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
    workspaceOverlayMode = 'closed'
    publishState({ settingsOpen: true })
  })

  ipcMain.handle('launcher:set-shortcut-capture', (_evt, active: boolean) => {
    winComposer?.setShortcutCaptureActive(Boolean(active))
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
      showTerminalByDefault: payload.preferences?.showTerminalByDefault ?? false,
      blurRadarBackdrop: payload.preferences?.blurRadarBackdrop ?? true,
      shortcuts: normalizeShortcutBindings(payload.preferences?.shortcuts),
      enableSlotShortcuts: payload.preferences?.enableSlotShortcuts ?? true
    }
    savePersistedSettings(app.getPath('userData'), persistedSettings)

    setupApplicationMenu()

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
    winComposer?.setShortcutCaptureActive(false)
    publishState({ settingsOpen: false })
  })

  ipcMain.handle('launcher:restart-backend', async () => {
    workspaceOverlayMode = 'closed'
    await bootstrapBackend()
  })

  // --- Horizontal 5-Slot View Palettes ---

  ipcMain.handle('workspace:set-overlay-mode', async (_evt, mode: WorkspaceOverlayMode) => {
    await setOverlayModeWithSync(mode)
  })

  ipcMain.handle(
    'workspace:activate-view',
    async (
      _evt,
      payload: {
        view: WorkspaceViewRef
        options?: { removeFromSlot?: { paletteId: string; slotIndex: number } }
      }
    ) => {
      return navigateToWorkspaceView(payload.view, payload.options)
    }
  )

  ipcMain.handle(
    'workspace:pin-slot',
    (_evt, payload: { paletteId: string; slotIndex: number; view?: WorkspaceViewRef }) => {
      const targetView = payload.view ?? computeLiveWorkspaceView()
      if (!targetView) return false
      const ok = workspaceStore.assignViewToSlot(payload.paletteId, payload.slotIndex, targetView)
      if (ok) publishState({})
      return ok
    }
  )

  ipcMain.handle(
    'workspace:move-slot',
    (_evt, payload: { paletteId: string; fromIndex: number; toIndex: number }) => {
      const ok = workspaceStore.moveOrSwapSlot(
        payload.paletteId,
        payload.fromIndex,
        payload.toIndex
      )
      if (ok) publishState({})
      return ok
    }
  )

  ipcMain.handle(
    'workspace:remove-slot',
    (_evt, payload: { paletteId: string; slotIndex: number }) => {
      const removed = workspaceStore.removeSlotView(payload.paletteId, payload.slotIndex)
      if (removed) publishState({})
      return Boolean(removed)
    }
  )

  ipcMain.handle(
    'workspace:rename-slot',
    (_evt, payload: { paletteId: string; slotIndex: number; customTitle: string }) => {
      const ok = workspaceStore.renameSlotView(
        payload.paletteId,
        payload.slotIndex,
        payload.customTitle
      )
      if (ok) publishState({})
      return ok
    }
  )

  ipcMain.handle('workspace:select-palette', (_evt, paletteId: string) => {
    if (workspaceStore.setActivePalette(paletteId)) {
      publishState({})
    }
  })

  ipcMain.handle('workspace:create-palette', (_evt, name?: string) => {
    const created = workspaceStore.createPalette(name)
    publishState({})
    return created
  })

  ipcMain.handle(
    'workspace:rename-palette',
    (_evt, payload: { paletteId: string; name: string }) => {
      const ok = workspaceStore.renamePalette(payload.paletteId, payload.name)
      if (ok) publishState({})
      return ok
    }
  )

  ipcMain.handle(
    'workspace:set-palette-locked',
    (_evt, payload: { paletteId: string; locked: boolean }) => {
      const ok = workspaceStore.setPaletteLocked(payload.paletteId, payload.locked)
      if (ok) publishState({})
      return ok
    }
  )

  ipcMain.handle('workspace:clear-palette', (_evt, paletteId: string) => {
    const ok = workspaceStore.clearPaletteSlots(paletteId)
    if (ok) publishState({})
    return ok
  })

  ipcMain.handle('workspace:delete-palette', (_evt, paletteId: string) => {
    const ok = workspaceStore.deletePalette(paletteId)
    if (ok) publishState({})
    return ok
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
  const userDataPath = app.getPath('userData')
  persistedSettings = loadPersistedSettings(userDataPath)
  workspaceStore.load(userDataPath)

  appState.binaries = computeBinarySettings()
  appState.preferences = computeCaptainPreferences(persistedSettings)
  appState.workspace = workspaceStore.getSnapshot('closed', null)

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
  winComposer = new WindowComposer(preloadPath, iconPath, handleGlobalWindowShortcut)
  winComposer.on('radar-location-changed', (loc: RadarLocationSnapshot) => {
    latestRadarLocation = loc
    if (shouldShowOverlay(appState)) {
      publishState({})
    }
  })

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
