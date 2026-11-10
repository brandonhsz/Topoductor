import { app } from 'electron'
import { join } from 'node:path'

let topoProfileDirectory: string | null = null

/** Browser profile ids repeat across Topo profiles ("default"), so their extension data lives per Topo profile. */
export function configureBrowserExtensionProfileDataDirectory(profileDirectory: string): void {
  topoProfileDirectory = profileDirectory
}

/** Root of the per-browser-profile extension stores (sync storage, grants and state, DNR). */
export function getBrowserExtensionProfileDataDirectory(): string {
  return join(topoProfileDirectory ?? app.getPath('userData'), 'browser-extensions')
}
