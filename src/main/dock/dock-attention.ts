import type { BrowserWindow, Dock } from 'electron'

export type DockAttentionResult = 'bounced' | 'flashed' | 'skipped-focused' | 'unsupported'

export type DockAttentionDeps = {
  platform: NodeJS.Platform
  window: Pick<BrowserWindow, 'isFocused' | 'flashFrame'> | null
  dock: Pick<Dock, 'bounce'> | undefined
}

/** Permission-free attention cue: Dock bounce on macOS, taskbar flash elsewhere. */
export function requestDockAttention({
  platform,
  window,
  dock
}: DockAttentionDeps): DockAttentionResult {
  if (window?.isFocused()) {
    return 'skipped-focused'
  }
  if (platform === 'darwin') {
    if (!dock) {
      return 'unsupported'
    }
    dock.bounce('informational')
    return 'bounced'
  }
  if ((platform === 'win32' || platform === 'linux') && window) {
    window.flashFrame(true)
    return 'flashed'
  }
  return 'unsupported'
}
