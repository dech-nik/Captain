import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppStatusState,
  PalettePreferencesPatch,
  SaveSettingsPayload,
  TeleportMfaMode,
  WorkspaceOverlayMode,
  WorkspacePalette,
  WorkspaceViewRef
} from '@shared/types'

export interface LauncherBridgeApi {
  getState: () => Promise<AppStatusState>
  onStateChange: (cb: (state: AppStatusState) => void) => () => void
  onPtyData: (cb: (chunk: string) => void) => () => void
  submitProxyConfig: (
    proxyAddr: string,
    usernameOverride?: string,
    mfaMode?: TeleportMfaMode
  ) => Promise<void>
  submitAuthInput: (value: string) => Promise<void>
  writeRawPty: (data: string) => void
  resizePty: (cols: number, rows: number) => void
  retryAuth: (
    usernameOverride?: string,
    proxyAddrOverride?: string,
    mfaMode?: TeleportMfaMode
  ) => Promise<void>
  cancelAuth: () => Promise<void>
  openSettings: () => Promise<void>
  saveSettings: (payload: SaveSettingsPayload) => Promise<void>
  clearSavedIdentity: () => Promise<void>
  pickBinaryFile: (title: string) => Promise<string | null>
  closeSettings: () => Promise<void>
  restartBackend: () => Promise<void>
  setShortcutCaptureActive: (active: boolean) => Promise<void>

  // Cluster Quick-Switcher & Favorites
  setWorkspaceOverlayMode: (mode: WorkspaceOverlayMode) => Promise<void>
  switchClusterContext: (contextName: string) => Promise<boolean>
  toggleFavoriteContext: (contextName: string) => Promise<boolean>

  // Horizontal View Palettes
  activateWorkspaceView: (
    view: WorkspaceViewRef,
    options?: { removeFromSlot?: { paletteId: string; slotIndex: number } }
  ) => Promise<boolean>
  pinViewToSlot: (
    paletteId: string,
    slotIndex: number,
    view?: WorkspaceViewRef
  ) => Promise<boolean>
  movePaletteSlot: (paletteId: string, fromIndex: number, toIndex: number) => Promise<boolean>
  removePaletteSlot: (paletteId: string, slotIndex: number) => Promise<boolean>
  renamePaletteSlot: (
    paletteId: string,
    slotIndex: number,
    customTitle: string
  ) => Promise<boolean>
  selectPalette: (paletteId: string) => Promise<void>
  createPalette: (name?: string) => Promise<WorkspacePalette>
  renamePalette: (paletteId: string, name: string) => Promise<boolean>
  setPaletteLocked: (paletteId: string, locked: boolean) => Promise<boolean>
  clearPaletteSlots: (paletteId: string) => Promise<boolean>
  deletePalette: (paletteId: string) => Promise<boolean>
  updatePalettePreferences: (patch: PalettePreferencesPatch) => Promise<void>
}

const api: LauncherBridgeApi = {
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  onStateChange: (cb) => {
    const listener = (_evt: Electron.IpcRendererEvent, state: AppStatusState): void => cb(state)
    ipcRenderer.on('launcher:state-changed', listener)
    return () => ipcRenderer.removeListener('launcher:state-changed', listener)
  },
  onPtyData: (cb) => {
    const listener = (_evt: Electron.IpcRendererEvent, chunk: string): void => cb(chunk)
    ipcRenderer.on('launcher:pty-data', listener)
    return () => ipcRenderer.removeListener('launcher:pty-data', listener)
  },
  submitProxyConfig: (proxyAddr: string, usernameOverride?: string, mfaMode?: TeleportMfaMode) =>
    ipcRenderer.invoke('launcher:submit-proxy-config', { proxyAddr, usernameOverride, mfaMode }),
  submitAuthInput: (value: string) => ipcRenderer.invoke('launcher:submit-auth-input', value),
  writeRawPty: (data: string) => ipcRenderer.send('launcher:pty-write', data),
  resizePty: (cols: number, rows: number) => ipcRenderer.send('launcher:pty-resize', cols, rows),
  retryAuth: (
    usernameOverride?: string,
    proxyAddrOverride?: string,
    mfaMode?: TeleportMfaMode
  ) => ipcRenderer.invoke('launcher:retry-auth', { usernameOverride, proxyAddrOverride, mfaMode }),
  cancelAuth: () => ipcRenderer.invoke('launcher:cancel-auth'),
  openSettings: () => ipcRenderer.invoke('launcher:open-settings'),
  saveSettings: (payload: SaveSettingsPayload) =>
    ipcRenderer.invoke('launcher:save-settings', payload),
  clearSavedIdentity: () => ipcRenderer.invoke('launcher:clear-saved-identity'),
  pickBinaryFile: (title: string) => ipcRenderer.invoke('launcher:pick-binary', title),
  closeSettings: () => ipcRenderer.invoke('launcher:close-settings'),
  restartBackend: () => ipcRenderer.invoke('launcher:restart-backend'),
  setShortcutCaptureActive: (active: boolean) =>
    ipcRenderer.invoke('launcher:set-shortcut-capture', active),

  setWorkspaceOverlayMode: (mode: WorkspaceOverlayMode) =>
    ipcRenderer.invoke('workspace:set-overlay-mode', mode),
  switchClusterContext: (contextName: string) =>
    ipcRenderer.invoke('workspace:switch-context', contextName),
  toggleFavoriteContext: (contextName: string) =>
    ipcRenderer.invoke('workspace:toggle-favorite', contextName),

  activateWorkspaceView: (view, options) =>
    ipcRenderer.invoke('workspace:activate-view', { view, options }),
  pinViewToSlot: (paletteId, slotIndex, view) =>
    ipcRenderer.invoke('workspace:pin-slot', { paletteId, slotIndex, view }),
  movePaletteSlot: (paletteId, fromIndex, toIndex) =>
    ipcRenderer.invoke('workspace:move-slot', { paletteId, fromIndex, toIndex }),
  removePaletteSlot: (paletteId, slotIndex) =>
    ipcRenderer.invoke('workspace:remove-slot', { paletteId, slotIndex }),
  renamePaletteSlot: (paletteId, slotIndex, customTitle) =>
    ipcRenderer.invoke('workspace:rename-slot', { paletteId, slotIndex, customTitle }),
  selectPalette: (paletteId) => ipcRenderer.invoke('workspace:select-palette', paletteId),
  createPalette: (name) => ipcRenderer.invoke('workspace:create-palette', name),
  renamePalette: (paletteId, name) =>
    ipcRenderer.invoke('workspace:rename-palette', { paletteId, name }),
  setPaletteLocked: (paletteId, locked) =>
    ipcRenderer.invoke('workspace:set-palette-locked', { paletteId, locked }),
  clearPaletteSlots: (paletteId) => ipcRenderer.invoke('workspace:clear-palette', paletteId),
  deletePalette: (paletteId) => ipcRenderer.invoke('workspace:delete-palette', paletteId),
  updatePalettePreferences: (patch) => ipcRenderer.invoke('workspace:update-prefs', patch)
}

contextBridge.exposeInMainWorld('launcherApi', api)
