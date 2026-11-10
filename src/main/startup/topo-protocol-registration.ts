import type { App } from 'electron'

/**
 * Registers `topo://` with Windows, which NSIS installs leave unregistered; macOS reads it from
 * Info.plist and Linux packages from the desktop entry. Only packaged desktop launches register,
 * so dev, test and serve runs never take over the machine's handler.
 */
export function registerTopoProtocolClient(
  app: Pick<App, 'isPackaged' | 'isDefaultProtocolClient' | 'setAsDefaultProtocolClient'>,
  options: { platform: NodeJS.Platform; desktopLaunch: boolean }
): boolean {
  if (options.platform !== 'win32' || !app.isPackaged || !options.desktopLaunch) {
    return false
  }
  if (app.isDefaultProtocolClient('topo')) {
    return false
  }
  try {
    return app.setAsDefaultProtocolClient('topo')
  } catch (error) {
    console.warn('[protocol] Failed to register topo:// links:', error)
    return false
  }
}
