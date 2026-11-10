import type { PluginThemeBackground } from '../../../shared/plugins/artifacts/plugin-theme-background'
import { useThemeBackgroundStore } from '@/store/appearance/theme-background'
import { syncWindowMaterialWithThemeBackground } from './window-material-runtime'

const SIZE: Record<
  NonNullable<PluginThemeBackground['size']>,
  [size: string, repeat: string, videoFit: string]
> = {
  cover: ['cover', 'no-repeat', 'cover'],
  contain: ['contain', 'no-repeat', 'contain'],
  // A video cannot tile; it covers like the default.
  tile: ['auto', 'repeat', 'cover']
}

const PROPERTIES = [
  '--topo-theme-background-image',
  '--topo-theme-background-size',
  '--topo-theme-background-repeat',
  '--topo-theme-background-video-fit',
  '--topo-theme-background-position',
  '--topo-theme-background-opacity',
  '--topo-theme-background-surface-opacity'
] as const

/** Paints (or clears) the theme's image as the body's static background layer; see main.css.
 *  Its video, if any, layers over it (theme-background-video.ts). `surfaceOpacity` is Background
 *  Opacity, which chats over the image paint at too. */
export function applyThemeBackground(
  background: PluginThemeBackground | null | undefined,
  surfaceOpacity = 1,
  root: HTMLElement = document.documentElement
): void {
  if (!background) {
    for (const property of PROPERTIES) {
      root.style.removeProperty(property)
    }
    delete root.dataset.themeBackground
    useThemeBackgroundStore.setState({ active: false })
    syncWindowMaterialWithThemeBackground(false)
    return
  }
  const [size, repeat, videoFit] = SIZE[background.size ?? 'cover']
  // Why JSON quoting: registration only admits orca-plugin-image URLs, and a quoted CSS string cannot break out.
  root.style.setProperty('--topo-theme-background-image', `url(${JSON.stringify(background.url)})`)
  root.style.setProperty('--topo-theme-background-size', size)
  root.style.setProperty('--topo-theme-background-repeat', repeat)
  root.style.setProperty('--topo-theme-background-video-fit', videoFit)
  root.style.setProperty('--topo-theme-background-position', background.position ?? 'center')
  root.style.setProperty('--topo-theme-background-opacity', String(background.opacity ?? 1))
  root.style.setProperty('--topo-theme-background-surface-opacity', String(surfaceOpacity))
  root.dataset.themeBackground = ''
  useThemeBackgroundStore.setState({ active: true })
  syncWindowMaterialWithThemeBackground(true)
}
