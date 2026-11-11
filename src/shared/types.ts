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

export interface CaptainPreferences {
  defaultTeleportProxy: string
  defaultTeleportUser: string
  mfaMode: TeleportMfaMode
  syncAllClusters: boolean
  autoSelectTeleportCluster: boolean
  showTerminalByDefault: boolean
}

export interface SaveSettingsPayload {
  radarPath: string
  tshPath: string
  preferences: CaptainPreferences
}

export interface AppStatusState {
  phase: 'starting' | 'missing_binaries' | 'ready' | 'auth_required' | 'fatal_error'
  radarUrl: string | null
  currentContext: string
  errorMessage?: string
  binaries: BinarySettings
  preferences: CaptainPreferences
  login: LoginUiState | null
  settingsOpen: boolean
}
