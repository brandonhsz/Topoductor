import type { SupplementUpdate } from './backend-client'
import { savedSize, sizeMismatch } from './presentation'
import type { MeliReading, Product, ProductStatus } from './protocol'

export const STATUS_LABELS: Record<ProductStatus, string> = {
  sin_revisar: 'Sin revisar',
  ok: 'Al día',
  precio_cambio: 'Cambio de precio',
  sin_precio_base: 'Sin precio guardado',
  revisar_salto: 'Salto mayor a 50%',
  revisar_identidad: 'Revisar identidad',
  otra_presentacion: 'Otra presentación',
  link_compartido: 'Link compartido',
  roto: 'Link roto',
  link_directo: 'Link sin referido',
  referido_rechazado: 'Referido rechazado',
  referido_listo: 'Referido listo'
}

/** What each status means, shown when hovering it. */
export const STATUS_DESCRIPTIONS: Record<ProductStatus, string> = {
  sin_revisar: 'Su link aún no se lee en MercadoLibre. Usa «Leer precios en ML».',
  ok: 'El precio guardado coincide con el de MercadoLibre (diferencia de 1% o menos).',
  precio_cambio:
    'MercadoLibre muestra otro precio (diferencia entre 1% y 50%). Se puede aplicar en lote.',
  sin_precio_base:
    'No tiene precio guardado y MercadoLibre sí muestra uno. Se puede aplicar en lote.',
  revisar_salto:
    'El precio cambió más de 50%: puede ser otro producto o una promoción. Revísalo antes de aplicarlo.',
  revisar_identidad:
    'La marca no aparece en el título de MercadoLibre: el link podría apuntar a otro producto.',
  link_compartido:
    'Varios productos usan el mismo link (p. ej. sabores o tamaños). Si su precio en MercadoLibre cambió, se aplica con los cambios de precio aunque podría ser de otra presentación.',
  roto: 'El link abre la lista genérica del afiliado, no el producto: salió de las recomendaciones o de venta.',
  link_directo:
    'Tiene link directo de MercadoLibre, sin referido: no genera comisión. Genera su referido.',
  referido_rechazado:
    'MercadoLibre no generó su referido; el motivo queda guardado en el producto. Se puede reintentar más adelante.',
  referido_listo:
    'Ya hay un referido que abre el producto; falta guardarlo con «Guardar N referidos generados». Al guardarlo se vuelve a leer para confirmar que quedó.',
  otra_presentacion:
    'El tamaño en MercadoLibre no coincide con el del producto (p. ej. 480 g contra 510 g): el precio es de otra presentación. Revísalo antes de aplicarlo o busca el link de su tamaño.'
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

/**
 * Whether a listing title names this product, not just its brand: most words of the name
 * (brand words aside) must appear in it. Catalog names in English rarely pass against Spanish
 * titles; those are left for a person to search by hand.
 */
export function nameMatches(brand: string, name: string, title: string): boolean {
  const brandWords = new Set(normalize(brand).split(' '))
  const words = normalize(name)
    .split(' ')
    .filter((word) => word.length > 1 && !brandWords.has(word))
  if (words.length === 0) {
    return false
  }
  const normalizedTitle = normalize(title)
  const found = words.filter((word) => normalizedTitle.includes(word)).length
  return found / words.length >= 0.6
}

export function isMeliUrl(url: string): boolean {
  return /^https:\/\/(meli\.la|(www\.|articulo\.)?mercadolibre\.com\.mx)\//i.test(url.trim())
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

type Classifiable = Pick<
  Product,
  'brand' | 'name' | 'quantity' | 'price' | 'linkKind' | 'sharedCount' | 'reading' | 'proposal'
>

export function classify(product: Classifiable): ProductStatus {
  const { reading } = product
  // A replacement waiting to be saved, for a direct link or a broken one.
  if (product.proposal?.url && (product.linkKind === 'directo' || reading?.ok === false)) {
    return 'referido_listo'
  }
  if (product.linkKind === 'directo') {
    return product.proposal && !product.proposal.url ? 'referido_rechazado' : 'link_directo'
  }
  if (!reading) {
    return 'sin_revisar'
  }
  if (!reading.ok) {
    return 'roto'
  }
  // Another size of the same product weighs more than a shared link: its price is not this one's.
  if (sizeMismatch(savedSize(product.name, product.quantity), reading.title)) {
    return 'otra_presentacion'
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

/** A referral link whose ML reading shows a price different from the saved one, whatever its status. */
export function hasNewMlPrice(product: Product): boolean {
  const { reading } = product
  return (
    product.linkKind === 'referido' &&
    reading?.ok === true &&
    reading.price !== null &&
    reading.price > 0 &&
    reading.price !== product.price
  )
}

/** What «Aplicar cambios de precio» writes: price changes, missing prices and shared links. */
export function isApplicable(product: Product): boolean {
  return (
    APPLICABLE_STATUSES.includes(product.status) ||
    (product.status === 'link_compartido' && hasNewMlPrice(product))
  )
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
