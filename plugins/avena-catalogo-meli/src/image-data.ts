// Panels load nothing from the network; the worker fetches a product photo and hands the panel
// its bytes as a data: URL. Topo refuses a whole render past 512 KiB, so photos stay small.
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 24_000

/** `thumb` for a list of results (about 5 KB), `preview` for the one chosen (about 13 KB). */
export type ImageSize = 'thumb' | 'preview'

export type ImageFetcher = (url: string, size: ImageSize) => Promise<string | null>

/**
 * MercadoLibre serves each photo in several sizes, picked by its file name:
 * `D_Q_NP_2X_<id>-E.webp` is about 13 KB, `D_Q_NP_<id>-E.webp` about 5 KB.
 */
export function sizedImageUrl(url: string, size: ImageSize): string {
  return url
    .replace(/\/D_(?:Q|NQ)_NP_(?:2X_)?/, size === 'thumb' ? '/D_Q_NP_' : '/D_Q_NP_2X_')
    .replace(/-[A-Z]\.(webp|jpe?g|png)$/i, '-E.$1')
}

export function imageFetcher(fetchImpl: typeof fetch = fetch): ImageFetcher {
  return async (url, size) => {
    if (!/^https:\/\/[a-z0-9.-]+\.mlstatic\.com\//i.test(url)) {
      return null
    }
    try {
      const response = await fetchImpl(sizedImageUrl(url, size))
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!response.ok || !TYPES.has(type)) {
        return null
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      return bytes.length > 0 && bytes.length <= MAX_BYTES
        ? `data:${type};base64,${bytes.toString('base64')}`
        : null
    } catch {
      return null
    }
  }
}
