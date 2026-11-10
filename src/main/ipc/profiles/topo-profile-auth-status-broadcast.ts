import { BrowserWindow } from 'electron'
import {
  TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type TopoCloudSignInProgress
} from '../../../shared/topo-profiles'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(channel, ...args)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function broadcastTopoProfileAuthStatusChanged(): void {
  broadcast(TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
}

export function broadcastTopoProfileSignInProgressChanged(
  progress: TopoCloudSignInProgress | null
): void {
  broadcast(TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
