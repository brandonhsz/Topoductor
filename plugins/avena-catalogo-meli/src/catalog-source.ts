// Reads one owner's products sold through MercadoLibre, straight from Mongo (read-only user).
import type { LinkKind } from './protocol'
import { isReferralUrl } from './catalog-status'

export type SourceProduct = {
  id: string
  name: string
  brand: string
  owner: string
  quantity: string | null
  flavor: string | null
  productURL: string
  linkKind: LinkKind
  price: number | null
  listPrice: number | null
  discountPercentage: number | null
  mlItemId: string | null
  priceCheckedAt: string | null
  hasStock: boolean | null
  margin: number | null
}

export type CatalogSource = (ids?: readonly string[]) => Promise<SourceProduct[]>

type SupplementDocument = {
  _id: string
  name?: string
  brand?: string
  owner?: string
  quantity?: string | null
  flavor?: string | null
  productURL: string
  price?: number | null
  listPrice?: number | null
  discountPercentage?: number | null
  mlItemId?: string | null
  priceCheckedAt?: Date | string | null
  hasStock?: boolean | null
  adjustmentMarginPercentage?: number | null
}

const MELI_URL = /meli\.la|mercadolibre\.com\.mx/i

/**
 * Atlas shows each node's host (`<cluster>-shard-00-01.<id>.mongodb.net:27017`); with
 * mongodb+srv that host has no SRV record. Point it at the cluster host, which does.
 */
export function normalizeMongoUri(uri: string): string {
  return uri
    .trim()
    .replace(
      /^(mongodb\+srv:\/\/[^@/]*@)([^.]+)-shard-\d+-\d+(\.[^/:?]+)(:\d+)?/i,
      (_match, auth: string, cluster: string, domain: string) => `${auth}${cluster}${domain}`
    )
}

export function toSourceProduct(doc: SupplementDocument): SourceProduct {
  const productURL = doc.productURL.trim()
  const checkedAt = doc.priceCheckedAt
  return {
    id: String(doc._id),
    name: doc.name ?? '',
    brand: doc.brand ?? '',
    owner: doc.owner ?? '',
    quantity: doc.quantity ?? null,
    flavor: doc.flavor ?? null,
    productURL,
    linkKind: isReferralUrl(productURL) ? 'referido' : 'directo',
    price: typeof doc.price === 'number' ? doc.price : null,
    listPrice: doc.listPrice ?? null,
    discountPercentage: doc.discountPercentage ?? null,
    mlItemId: doc.mlItemId ?? null,
    priceCheckedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
    hasStock: typeof doc.hasStock === 'boolean' ? doc.hasStock : null,
    margin: doc.adjustmentMarginPercentage ?? null
  }
}

export type MongoLocation = { database: string; collection: string; owner: string }

export function mongoCatalogSource(uri: string, location: MongoLocation): CatalogSource {
  return async (ids) => {
    // Loaded on demand: the bundled driver is large and only the worker needs it.
    const { MongoClient } = await import('../vendor/mongodb.mjs')
    const client = new MongoClient(uri, {
      readPreference: 'secondaryPreferred',
      serverSelectionTimeoutMS: 15_000
    })
    await client.connect()
    try {
      const query: Record<string, unknown> = {
        owner: location.owner,
        productURL: MELI_URL,
        deletedDate: null
      }
      if (ids) {
        query._id = { $in: ids }
      }
      const docs = await client
        .db(location.database)
        .collection<SupplementDocument>(location.collection)
        .find(query, {
          projection: {
            name: 1,
            brand: 1,
            owner: 1,
            quantity: 1,
            flavor: 1,
            productURL: 1,
            price: 1,
            listPrice: 1,
            discountPercentage: 1,
            mlItemId: 1,
            priceCheckedAt: 1,
            hasStock: 1,
            adjustmentMarginPercentage: 1
          }
        })
        .toArray()
      return docs.map(toSourceProduct)
    } finally {
      await client.close()
    }
  }
}
