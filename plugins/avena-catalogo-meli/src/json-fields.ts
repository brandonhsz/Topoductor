// Typed reads of JSON that crosses a process boundary (the topo CLI, a page, the backend, storage).
import type { Catalog, MeliReading } from './protocol'

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** A featured-card reading as the page script returns it, with the time it was read. */
export function toCardReading(raw: JsonRecord, checkedAt: number): MeliReading & { url: string } {
  return {
    url: text(raw.url) ?? '',
    ok: raw.ok === true,
    blocked: raw.blocked === true,
    checkedAt,
    price: amount(raw.price),
    listPrice: amount(raw.listPrice),
    discountPercentage: amount(raw.discountPercentage),
    title: text(raw.title),
    seller: text(raw.seller),
    mlItemId: text(raw.mlItemId),
    imageUrl: text(raw.imageUrl)
  }
}

export function isCatalog(value: unknown): value is Catalog {
  return isRecord(value) && Array.isArray(value.products)
}
