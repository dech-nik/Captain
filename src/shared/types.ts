export type TeleportMfaMode = 'auto' | 'cross-platform' | 'platform' | 'otp'

export interface TeleportMetadata {
  isTeleport: boolean
  proxyAddr?: string
  teleportCluster?: string
  kubeCluster?: string
  username?: string
}

export interface ContextSummary {
  name: string
  cluster: string
  namespace?: string
  teleport: TeleportMetadata
}

export interface ProxyReadyEvent {
  type: 'proxy:ready'
  port: number
  syntheticKubeconfig: string
  contexts: ContextSummary[]
  currentContext: string
}

export interface ProxyContextsUpdatedEvent {
  type: 'proxy:contexts_updated'
  contexts: ContextSummary[]
  currentContext: string
}

export interface ProxyActiveContextEvent {
  type: 'proxy:active_context'
  context: string
}

export interface ProxyAuthRequiredEvent {
  type: 'auth:required'
  context: string
  reason: string
  statusCode?: number
  teleport: TeleportMetadata
}

export interface ProxyDiagnosticEvent {
  type: 'proxy:diagnostic'
  context: string
  category: string
  statusCode?: number
  detail: string
}

export type ProxyOutboundEvent =
  | ProxyReadyEvent
  | ProxyContextsUpdatedEvent
  | ProxyActiveContextEvent
  | ProxyAuthRequiredEvent
  | ProxyDiagnosticEvent

export interface ProxyInboundCommand {
  type: 'auth:completed' | 'auth:cancelled' | 'proxy:reload'
  context?: string
}

export type LoginStep =
  | 'proxy_input'
  | 'starting'
  | 'username'
  | 'password'
  | 'yubikey_pin'
  | 'yubikey_touch'
  | 'mfa_touch_or_otp'
  | 'otp'
  | 'authenticating'
  | 'syncing_kubeconfig'
  | 'unknown_prompt'
  | 'success'
  | 'error'

export interface LoginUiState {
  active: boolean
  context: string
  reason: string
  teleport: TeleportMetadata
  mfaMode: TeleportMfaMode
  step: LoginStep
  promptText: string
  errorMessage?: string
  forceTerminalOpen: boolean
}

export interface BinarySettings {
  radarPath: string
  tshPath: string
  resolvedRadarPath: string | null
  resolvedTshPath: string | null
  kubeconfigEnv: string
}

export type ShortcutActionId =
  | 'quickSwitcher'
  | 'paletteMenu'
  | 'openSettings'
  | 'teleportLogin'
  | 'reconnectCluster'

export type ShortcutBindings = Record<ShortcutActionId, string>

export interface CaptainPreferences {
  defaultTeleportProxy: string
  defaultTeleportUser: string
  mfaMode: TeleportMfaMode
  syncAllClusters: boolean
  autoSelectTeleportCluster: boolean
  showTerminalByDefault: boolean
  blurRadarBackdrop: boolean
  shortcuts: ShortcutBindings
  enableSlotShortcuts: boolean
}

export interface SaveSettingsPayload {
  radarPath: string
  tshPath: string
  preferences: CaptainPreferences
}

export type ViewResourceCategory =
  | 'overview'
  | 'topology'
  | 'pods'
  | 'workloads'
  | 'network'
  | 'config'
  | 'storage'
  | 'nodes'
  | 'rbac'
  | 'helm'
  | 'gitops'
  | 'applications'
  | 'issues'
  | 'timeline'
  | 'traffic'
  | 'cost'
  | 'checks'
  | 'crd'

export interface WorkspaceViewRef {
  id: string
  context: string
  clusterLabel: string
  isTeleport: boolean
  routePath: string
  category: ViewResourceCategory
  kindShort: string
  kindName: string
  targetName?: string
  namespaces: string[]
  customTitle?: string
  createdAt: number
}

export interface WorkspacePalette {
  id: string
  name: string
  locked: boolean
  slots: Array<WorkspaceViewRef | null>
  createdAt: number
  updatedAt: number
}

export type WorkspaceOverlayMode = 'closed' | 'quick_switcher' | 'palette'

export interface WorkspaceOrganizerState {
  overlayMode: WorkspaceOverlayMode
  favoriteContexts: string[]
  palettes: WorkspacePalette[]
  activePaletteId: string
  slotCount: number
  removeOnDragOutside: boolean
  liveView: WorkspaceViewRef | null
}

export interface PalettePreferencesPatch {
  slotCount?: number
  removeOnDragOutside?: boolean
}

export interface AppStatusState {
  phase: 'starting' | 'missing_binaries' | 'ready' | 'auth_required' | 'fatal_error'
  radarUrl: string | null
  currentContext: string
  contexts: ContextSummary[]
  errorMessage?: string
  binaries: BinarySettings
  preferences: CaptainPreferences
  workspace: WorkspaceOrganizerState
  login: LoginUiState | null
  settingsOpen: boolean
}
