import { BaseWindow, Event as ElectronEvent, Input, shell, WebContentsView } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { normalizeRadarRoutePath } from '@shared/radar-route'

const RADAR_BASE_TRANSITION_CSS = 'html { transition: filter 130ms cubic-bezier(0.16, 1, 0.3, 1); }'
const RADAR_BLUR_ACTIVE_CSS =
  'html { filter: blur(7px) saturate(0.94) !important; user-select: none !important; }'

export interface RadarLocationSnapshot {
  routePath: string
  pageTitle: string
}

export class WindowComposer extends EventEmitter {
  public readonly baseWindow: BaseWindow
  public readonly radarView: WebContentsView
  public readonly overlayView: WebContentsView
  private overlayVisible = true
  private loadedRadarUrl: string | null = null
  private blurCssKey: string | null = null
  private wantRadarBlur = false
  private blurSyncPromise: Promise<void> = Promise.resolve()
  private shortcutCaptureActive = false

  constructor(
    preloadPath: string,
    iconPath?: string,
    onShortcutInput?: (event: ElectronEvent, input: Input) => void
  ) {
    super()

    this.baseWindow = new BaseWindow({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      title: 'Captain',
      backgroundColor: '#f6f8fb',
      show: false,
      ...(iconPath ? { icon: iconPath } : {})
    })

    // Primary WebContentsView displaying the unmodified local Radar web application
    this.radarView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    // Transparent overlay WebContentsView for Teleport login UI, palettes, quick-switcher, and settings
    this.overlayView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.overlayView.setBackgroundColor('#00000000')

    this.baseWindow.contentView.addChildView(this.radarView)
    this.baseWindow.contentView.addChildView(this.overlayView)

    this.setupNavigationGuards()
    this.setupRadarNavigationTracking()
    if (onShortcutInput) {
      this.setupShortcutInterception(onShortcutInput)
    }

    this.baseWindow.on('resize', () => this.layoutViews())
    this.baseWindow.on('closed', () => {
      // Views are cleaned up with window
    })

    this.layoutViews()
  }

  private setupNavigationGuards(): void {
    // Open external documentation / GitHub links from Radar in the OS default browser
    this.radarView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
        return { action: 'allow' }
      }
      shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })

    this.overlayView.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
  }

  private setupRadarNavigationTracking(): void {
    const emitIfRadarOrigin = (rawUrl: string): void => {
      if (!this.loadedRadarUrl || !rawUrl) return
      try {
        const expected = new URL(this.loadedRadarUrl)
        const current = new URL(rawUrl)
        if (current.origin !== expected.origin) return
        const routePath = normalizeRadarRoutePath(
          `${current.pathname}${current.search}${current.hash}`
        )
        const pageTitle = this.radarView.webContents.getTitle() || ''
        this.emit('radar-location-changed', {
          routePath,
          pageTitle
        } satisfies RadarLocationSnapshot)
      } catch {
        // ignore invalid intermediate navigation URLs
      }
    }

    this.radarView.webContents.on('did-finish-load', () => {
      this.blurCssKey = null
      this.radarView.webContents.insertCSS(RADAR_BASE_TRANSITION_CSS).catch(() => {})
      this.syncRadarBlurState()
      emitIfRadarOrigin(this.radarView.webContents.getURL())
    })

    this.radarView.webContents.on('did-navigate', (_evt, url) => {
      emitIfRadarOrigin(url)
    })

    this.radarView.webContents.on('did-navigate-in-page', (_evt, url, isMainFrame) => {
      if (!isMainFrame) return
      emitIfRadarOrigin(url)
    })

    this.radarView.webContents.on('page-title-updated', (_evt, title) => {
      if (!this.loadedRadarUrl || this.radarView.webContents.isDestroyed()) return
      const currentUrl = this.radarView.webContents.getURL()
      if (!currentUrl) return
      try {
        const expected = new URL(this.loadedRadarUrl)
        const current = new URL(currentUrl)
        if (current.origin !== expected.origin) return
        const routePath = normalizeRadarRoutePath(
          `${current.pathname}${current.search}${current.hash}`
        )
        this.emit('radar-location-changed', {
          routePath,
          pageTitle: title || ''
        } satisfies RadarLocationSnapshot)
      } catch {
        // ignore
      }
    })
  }

  private setupShortcutInterception(
    onShortcutInput: (event: ElectronEvent, input: Input) => void
  ): void {
    const forward = (event: ElectronEvent, input: Input): void => {
      if (this.shortcutCaptureActive) return
      onShortcutInput(event, input)
    }
    this.radarView.webContents.on('before-input-event', forward)
    this.overlayView.webContents.on('before-input-event', forward)
  }

  public setShortcutCaptureActive(active: boolean): void {
    this.shortcutCaptureActive = active
  }

  public getCurrentRadarLocation(): RadarLocationSnapshot {
    if (!this.loadedRadarUrl || this.radarView.webContents.isDestroyed()) {
      return { routePath: '/', pageTitle: '' }
    }
    const rawUrl = this.radarView.webContents.getURL()
    const pageTitle = this.radarView.webContents.getTitle() || ''
    if (!rawUrl) {
      return { routePath: '/', pageTitle }
    }
    try {
      const expected = new URL(this.loadedRadarUrl)
      const current = new URL(rawUrl)
      if (current.origin !== expected.origin) {
        return { routePath: '/', pageTitle }
      }
      return {
        routePath: normalizeRadarRoutePath(`${current.pathname}${current.search}${current.hash}`),
        pageTitle
      }
    } catch {
      return { routePath: '/', pageTitle }
    }
  }

  public layoutViews(): void {
    if (this.baseWindow.isDestroyed()) return
    const bounds = this.baseWindow.getContentBounds()
    const fullRect = { x: 0, y: 0, width: bounds.width, height: bounds.height }

    this.radarView.setBounds(fullRect)

    if (this.overlayVisible) {
      this.overlayView.setBounds(fullRect)
    } else {
      // Collapse overlay bounds to 0x0 so all pointer and keyboard events go straight to Radar
      this.overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  public setOverlayState(visible: boolean, blurRadar: boolean): void {
    const visibilityChanged = this.overlayVisible !== visible
    this.overlayVisible = visible
    this.wantRadarBlur = visible && blurRadar
    this.layoutViews()
    this.syncRadarBlurState()

    if (visibilityChanged) {
      if (visible) {
        this.overlayView.webContents.focus()
      } else {
        this.radarView.webContents.focus()
      }
    }
  }

  private syncRadarBlurState(): void {
    this.blurSyncPromise = this.blurSyncPromise
      .then(async () => {
        if (this.baseWindow.isDestroyed() || this.radarView.webContents.isDestroyed()) {
          return
        }
        const shouldBlur = Boolean(this.wantRadarBlur && this.loadedRadarUrl)
        if (shouldBlur && !this.blurCssKey) {
          try {
            this.blurCssKey = await this.radarView.webContents.insertCSS(RADAR_BLUR_ACTIVE_CSS)
          } catch {
            this.blurCssKey = null
          }
        } else if (!shouldBlur && this.blurCssKey) {
          const key = this.blurCssKey
          this.blurCssKey = null
          try {
            await this.radarView.webContents.removeInsertedCSS(key)
          } catch {
            // ignore if page reloaded in the meantime
          }
        }
      })
      .catch(() => {})
  }

  public async loadOverlayUI(): Promise<void> {
    if (process.env.ELECTRON_RENDERER_URL) {
      await this.overlayView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      await this.overlayView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }
    if (!this.baseWindow.isDestroyed() && !this.baseWindow.isVisible()) {
      this.baseWindow.show()
    }
  }

  public async loadRadarUrl(url: string): Promise<void> {
    if (this.loadedRadarUrl === url) return
    this.loadedRadarUrl = url
    this.blurCssKey = null
    await this.radarView.webContents.loadURL(url)
  }

  /**
   * Navigates Radar's BrowserRouter cleanly in-place without reloading the WebContentsView
   * or tearing down active SSE streams.
   */
  public async navigateRadarToPath(routePath: string): Promise<void> {
    if (!this.loadedRadarUrl || this.radarView.webContents.isDestroyed()) return
    const normalized = normalizeRadarRoutePath(routePath)
    const current = this.getCurrentRadarLocation()
    if (current.routePath === normalized) return

    const script = `(function() {
      const target = ${JSON.stringify(normalized)};
      if (window.location.pathname + window.location.search + window.location.hash === target) return true;
      window.history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return true;
    })();`

    try {
      await this.radarView.webContents.executeJavaScript(script, false)
    } catch {
      const targetUrl = new URL(normalized, this.loadedRadarUrl).toString()
      await this.radarView.webContents.loadURL(targetUrl)
    }
  }
}
