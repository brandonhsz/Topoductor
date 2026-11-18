import type { SupplementUpdate } from './backend-client'
import type { MeliReading, Product, ProductStatus } from './protocol'

export const STATUS_LABELS: Record<ProductStatus, string> = {
  sin_revisar: 'Sin revisar',
  ok: 'Al día',
  precio_cambio: 'Cambio de precio',
  sin_precio_base: 'Sin precio guardado',
  revisar_salto: 'Salto mayor a 50%',
  revisar_identidad: 'Revisar identidad',
  link_compartido: 'Link compartido',
  roto: 'Link roto',
  link_directo: 'Link sin referido'
}

/** Statuses whose ML price can be written without a person checking the match first. */
export const APPLICABLE_STATUSES: readonly ProductStatus[] = ['precio_cambio', 'sin_precio_base']

const PRICE_TOLERANCE_PCT = 1
const PRICE_JUMP_PCT = 50

// Catalog spellings that never appear as such in ML titles.
const BRAND_ALIASES: Record<string, string> = {
  sasha: 'sascha',
  'sasha fitness': 'sascha',
  'amazing an nutrition': 'amazing'
}

function normalize(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function brandMatches(brand: string, title: string | null): boolean {
  const normalizedBrand = normalize(BRAND_ALIASES[normalize(brand)] ?? brand)
  const words = normalizedBrand.split(' ').filter((word) => word.length > 2)
  if (words.length === 0) {
    return true
  }
  const normalizedTitle = normalize(title)
  return (
    words.some((word) => normalizedTitle.includes(word)) ||
    normalizedTitle.replace(/ /g, '').includes(normalizedBrand.replace(/ /g, ''))
  )
}

export function isReferralUrl(url: string): boolean {
  return /^https?:\/\/meli\.la\//i.test(url.trim())
}

export function priceDiffPct(saved: number | null, reading: MeliReading | null): number | null {
  if (!saved || saved <= 0 || !reading?.ok || reading.price === null) {
    return null
  }
  return Math.round((1000 * (reading.price - saved)) / saved) / 10
}

type Classifiable = Pick<Product, 'brand' | 'price' | 'linkKind' | 'sharedCount' | 'reading'>

export function classify(product: Classifiable): ProductStatus {
  const { reading } = product
  if (product.linkKind === 'directo') {
    return 'link_directo'
  }
  if (!reading) {
    return 'sin_revisar'
  }
  if (!reading.ok) {
    return 'roto'
  }
  if (product.sharedCount > 1) {
    return 'link_compartido'
  }
  if (!brandMatches(product.brand, reading.title)) {
    return 'revisar_identidad'
  }
  if (!product.price || product.price <= 0) {
    return 'sin_precio_base'
  }
  const diff = Math.abs(priceDiffPct(product.price, reading) ?? 0)
  if (diff > PRICE_JUMP_PCT) {
    return 'revisar_salto'
  }
  return diff > PRICE_TOLERANCE_PCT ? 'precio_cambio' : 'ok'
}

export function withStatus<T extends Product>(product: T): T {
  return {
    ...product,
    status: classify(product),
    diffPct: priceDiffPct(product.price, product.reading)
  }
}

/** The fields the backend writes for a price taken from ML; null when the reading cannot be used. */
export function pricePayload(product: Product): SupplementUpdate | null {
  const { reading } = product
  if (!reading?.ok || reading.price === null || reading.price <= 0) {
    return null
  }
  const payload: SupplementUpdate = {
    id: product.id,
    price: reading.price,
    priceCheckedAt: new Date(reading.checkedAt).toISOString()
  }
  // A list price at or under the paid price means the struck-through amount was misread.
  if (reading.listPrice !== null && reading.listPrice > reading.price) {
    payload.listPrice = reading.listPrice
    if (reading.discountPercentage !== null) {
      payload.discountPercentage = Math.min(99, Math.max(0, Math.round(reading.discountPercentage)))
    }
  }
  if (reading.mlItemId) {
    payload.mlItemId = reading.mlItemId
  }
  return payload
}
