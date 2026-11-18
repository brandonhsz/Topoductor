// Topo caps each stored value at 256 KiB, so the catalog is kept as a meta key plus shards of
// products. The meta key is written last: a reader that hears it change sees whole shards.
import { amount, field, isRecord } from './json-fields'
import type { Catalog, Product } from './protocol'

export const CATALOG_META_KEY = 'catalog.meta'
const SHARD_PREFIX = 'catalog.shard.'
// About 1 KiB per product with its reading and proposal, far under the cap.
const SHARD_SIZE = 60

type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue }

export type CatalogStore = {
  get(key: string): Promise<unknown>
  set(key: string, value: StoredValue): Promise<void>
  delete(key: string): Promise<void>
}

function shardKey(index: number): string {
  return `${SHARD_PREFIX}${index}`
}

function json(value: unknown): StoredValue {
  const parsed: StoredValue = JSON.parse(JSON.stringify(value))
  return parsed
}

function isProduct(value: unknown): value is Product {
  return isRecord(value) && typeof value.id === 'string' && typeof value.productURL === 'string'
}

export async function readCatalog(store: Pick<CatalogStore, 'get'>): Promise<Catalog> {
  const meta = await store.get(CATALOG_META_KEY)
  const shards = amount(field(meta, 'shards')) ?? 0
  const products: Product[] = []
  for (let index = 0; index < shards; index++) {
    const shard = await store.get(shardKey(index))
    products.push(...(Array.isArray(shard) ? shard.filter(isProduct) : []))
  }
  return { products, syncedAt: amount(field(meta, 'syncedAt')) }
}

export async function writeCatalog(store: CatalogStore, catalog: Catalog): Promise<void> {
  const previous = amount(field(await store.get(CATALOG_META_KEY), 'shards')) ?? 0
  const shards = Math.ceil(catalog.products.length / SHARD_SIZE)
  for (let index = 0; index < shards; index++) {
    await store.set(
      shardKey(index),
      json(catalog.products.slice(index * SHARD_SIZE, (index + 1) * SHARD_SIZE))
    )
  }
  await store.set(CATALOG_META_KEY, json({ shards, syncedAt: catalog.syncedAt }))
  for (let index = shards; index < previous; index++) {
    await store.delete(shardKey(index))
  }
}

/** Storage entries for a catalog, to seed tests and checks. */
export function catalogEntries(catalog: Catalog): Record<string, StoredValue> {
  const shards = Math.ceil(catalog.products.length / SHARD_SIZE)
  const entries: Record<string, StoredValue> = {
    [CATALOG_META_KEY]: json({ shards, syncedAt: catalog.syncedAt })
  }
  for (let index = 0; index < shards; index++) {
    entries[shardKey(index)] = json(
      catalog.products.slice(index * SHARD_SIZE, (index + 1) * SHARD_SIZE)
    )
  }
  return entries
}
