import type { BrowserPageZoomCommand } from '../../../../../shared/browser-page-zoom'

export type { BrowserPageZoomCommand } from '../../../../../shared/browser-page-zoom'

export const TOPO_BROWSER_PAGE_ZOOM_EVENT = 'topo:browser-page-zoom'

/** Zoom chords that land in Topo's own window while a browser pane holds focus. */
export function dispatchBrowserPageZoom(command: BrowserPageZoomCommand): void {
  window.dispatchEvent(new CustomEvent(TOPO_BROWSER_PAGE_ZOOM_EVENT, { detail: command }))
}

export function addBrowserPageZoomEventListener(
  callback: (command: BrowserPageZoomCommand) => void
): () => void {
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) {
      callback(event.detail)
    }
  }
  window.addEventListener(TOPO_BROWSER_PAGE_ZOOM_EVENT, listener)
  return () => window.removeEventListener(TOPO_BROWSER_PAGE_ZOOM_EVENT, listener)
}
