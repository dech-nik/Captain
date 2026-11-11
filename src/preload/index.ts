import { contextBridge, ipcRenderer } from 'electron'
import type { AppStatusState, SaveSettingsPayload, TeleportMfaMode } from '@shared/types'

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
  restartBackend: () => ipcRenderer.invoke('launcher:restart-backend')
}

contextBridge.exposeInMainWorld('launcherApi', api)
