import { app, BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { join } from 'node:path'
import { isBackgroundLaunch, showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import type { RemoteDesktopHostId } from '../../shared/remote-desktop/remote-desktop-contract'

const MIN_WIDTH = 640
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800
const REMOTE_DESKTOP_PARTITION = 'topo-remote-desktop'

type RemoteDesktopWindowEntry = { window: BrowserWindow; hostId: RemoteDesktopHostId }

// One window per host; reopening focuses it instead of starting a second session.
const windows = new Map<RemoteDesktopHostId, RemoteDesktopWindowEntry>()

function liveEntry(hostId: RemoteDesktopHostId): RemoteDesktopWindowEntry | null {
  const entry = windows.get(hostId)
  if (!entry || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) {
    windows.delete(hostId)
    return null
  }
  return entry
}

/** The host a remote desktop window was opened for, or null when the sender is not one. */
export function remoteDesktopHostOfRenderer(sender: WebContents): RemoteDesktopHostId | null {
  for (const [hostId, entry] of windows) {
    if (!entry.window.isDestroyed() && entry.window.webContents === sender) {
      return hostId
    }
  }
  return null
}

function loadRemoteDesktop(
  window: BrowserWindow,
  hostId: RemoteDesktopHostId,
  title: string
): void {
  const query = { host: hostId, title }
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const params = new URLSearchParams(query).toString()
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/remote-desktop.html?${params}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/remote-desktop.html'), { query })
  }
}

export function createOrFocusRemoteDesktopWindow(
  hostId: RemoteDesktopHostId,
  title: string
): BrowserWindow {
  const existing = liveEntry(hostId)
  if (existing) {
    if (existing.window.isMinimized()) {
      existing.window.restore()
    }
    if (!isBackgroundLaunch()) {
      existing.window.focus()
    }
    return existing.window
  }

  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      partition: REMOTE_DESKTOP_PARTITION,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  windows.set(hostId, { window, hostId })

  window.on('page-title-updated', (event) => event.preventDefault())
  window.once('ready-to-show', () => showWindowWithoutStealingFocus(window))
  window.on('closed', () => {
    if (windows.get(hostId)?.window === window) {
      windows.delete(hostId)
    }
  })

  loadRemoteDesktop(window, hostId, title)
  return window
}

export function closeAllRemoteDesktopWindows(): void {
  for (const { window } of windows.values()) {
    if (!window.isDestroyed()) {
      window.close()
    }
  }
  windows.clear()
}
