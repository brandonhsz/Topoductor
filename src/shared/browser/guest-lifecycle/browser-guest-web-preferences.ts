export const TOPO_BROWSER_GUEST_WEB_PREFERENCES = {
  disableHtmlFullscreenWindowResize: true
} as const

export const TOPO_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE = 'disableHtmlFullscreenWindowResize=true'

/** Use opaque white for blank pages under any desktop theme and screencast; transparent JPEG frames encode black. */
export const TOPO_BROWSER_PAGE_GUEST_WEB_PREFERENCES_ATTRIBUTE = `${TOPO_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE},transparent=false`
