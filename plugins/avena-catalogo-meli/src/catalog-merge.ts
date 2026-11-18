// How a product read from Mongo meets what the local catalog already knew about it.
import type { SourceProduct } from './catalog-source'
import { withStatus } from './catalog-status'
import type { Product } from './protocol'

export function fromSource(
  source: SourceProduct,
  previous: Product | undefined,
  sharedCount: number
): Product {
  const sameLink = previous?.productURL === source.productURL
  return withStatus({
    ...source,
    sharedCount,
    reading: sameLink ? previous.reading : null,
    proposal: sameLink ? previous.proposal : null,
    status: 'sin_revisar',
    diffPct: null
  })
}

export function sharedCounts(
  products: readonly { productURL: string; linkKind: string }[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const product of products) {
    if (product.linkKind === 'referido') {
      counts.set(product.productURL, (counts.get(product.productURL) ?? 0) + 1)
    }
  }
  return counts
}
