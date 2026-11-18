// Panels load nothing from the network; the worker fetches a product photo and hands the panel
// its bytes as a data: URL, which Topo's Image accepts up to 256 KiB.
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
// Base64 grows 4/3: this keeps the URL under the 256 KiB cap.
const MAX_BYTES = 180_000

export type ImageFetcher = (url: string) => Promise<string | null>

export function imageFetcher(fetchImpl: typeof fetch = fetch): ImageFetcher {
  return async (url) => {
    if (!/^https:\/\/[a-z0-9.-]+\.mlstatic\.com\//i.test(url)) {
      return null
    }
    try {
      const response = await fetchImpl(url)
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
