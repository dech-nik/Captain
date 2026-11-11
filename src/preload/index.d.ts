import type { LauncherBridgeApi } from './index'

declare global {
  interface Window {
    launcherApi: LauncherBridgeApi
  }
}
