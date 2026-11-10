import { getAppEnvironment, hasAppEnvironment } from './app-environment'

export function getTopoCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'topo-ide'
  }
  if (platform === 'win32') {
    return 'topo.cmd'
  }
  return 'topo'
}

/** The GNOME-conflict `topo-ide` rename is desktop-only: SSH relays and headless Topo servers put plain `topo` on PATH. */
export function skipsLinuxTopoCliRename(isRemote: boolean | undefined): boolean {
  if (isRemote) {
    return true
  }
  // Only a headless server publishes its own launcher; Windows ones (WSL launches) keep the rename.
  const launcher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  return launcher?.endsWith('/topo') ?? false
}
