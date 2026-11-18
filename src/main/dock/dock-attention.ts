import type { BrowserWindow, Dock } from 'electron'

export type DockAttentionResult = 'bounced' | 'flashed' | 'skipped-focused' | 'unsupported'

export type DockAttentionDeps = {
  platform: NodeJS.Platform
  window: Pick<BrowserWindow, 'isFocused' | 'flashFrame'> | null
  dock: Pick<Dock, 'bounce'> | undefined
}

/** Permission-free attention cue: Dock bounce on macOS, taskbar flash elsewhere. */
export function requestDockAttention(deps: DockAttentionDeps): DockAttentionResult {
  throw new Error(`requestDockAttention not implemented on ${deps.platform}`)
}
