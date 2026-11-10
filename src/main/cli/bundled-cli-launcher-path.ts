import { join } from 'node:path'

// Why `topo-ide` on Linux: packaged installs only put `topo-ide` on PATH.
export const LINUX_CLI_COMMAND_NAME = 'topo-ide'

// Keep path-only callers independent of cli-installer's Electron dependency.
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'topo')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'topo.exe')
  }
  return null
}
