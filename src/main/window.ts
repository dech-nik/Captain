import { BaseWindow, shell, WebContentsView } from 'electron'
import { join } from 'node:path'

export class WindowComposer {
  public readonly baseWindow: BaseWindow
  public readonly radarView: WebContentsView
  public readonly overlayView: WebContentsView
  private overlayVisible = true
  private loadedRadarUrl: string | null = null

  constructor(preloadPath: string, iconPath?: string) {
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

    // Transparent overlay WebContentsView for Teleport login UI, startup progress, and binary settings
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

  public setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible
    this.layoutViews()
    if (visible) {
      this.overlayView.webContents.focus()
    } else {
      this.radarView.webContents.focus()
    }
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
    await this.radarView.webContents.loadURL(url)
  }
}
