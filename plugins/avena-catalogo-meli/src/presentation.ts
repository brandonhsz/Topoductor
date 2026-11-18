// Package sizes read from a product name or a listing title ("1.14 kg", "480g", "180 Cáps"), so a
// listing of another presentation of the same product is not taken for this one.

type SizeClass = 'mass' | 'volume' | 'pieces'

export type Size = { kind: SizeClass; value: number }

// Units in base terms: grams, millilitres and pieces. Dosage units (mg, mcg, UI) are not sizes.
const UNITS: [RegExp, SizeClass, number][] = [
  [/^(kg|kilos?|kilogramos?)$/, 'mass', 1000],
  [/^(g|gr|grs|gramos?)$/, 'mass', 1],
  [/^(lb|lbs|libras?)$/, 'mass', 453.592],
  [/^(ml|mililitros?)$/, 'volume', 1],
  [/^(l|lt|lts|litros?)$/, 'volume', 1000],
  [
    /^(caps?|capsulas?|capsules?|tabs?|tabletas?|tablets?|softgels?|gomitas?|gummies|sobres?|piezas?|pzas?|pz|porciones|servings|unidades|un)$/,
    'pieces',
    1
  ]
]

// Same presentation when within 2%: catalogs and listings round sizes differently (1.02 kg, 1020 g).
const TOLERANCE = 0.02
// Smaller counts are usually a dose ("1 cápsula"), not the package.
const MIN_PIECES = 10

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function amount(raw: string): number {
  // "1,000" groups thousands; "1,5" is a decimal comma.
  const value = /,\d{3}$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.')
  return Number(value)
}

export function parseSizes(text: string | null | undefined): Size[] {
  const sizes: Size[] = []
  for (const match of normalize(text ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/g)) {
    const unit = UNITS.find(([pattern]) => pattern.test(match[2]))
    const value = amount(match[1])
    if (!unit || !Number.isFinite(value) || value <= 0) {
      continue
    }
    const [, kind, factor] = unit
    if (kind === 'pieces' && value < MIN_PIECES) {
      continue
    }
    sizes.push({ kind, value: value * factor })
  }
  return sizes
}

export function formatSize(size: Size): string {
  if (size.kind === 'mass') {
    return size.value >= 1000
      ? `${+(size.value / 1000).toFixed(2)} kg`
      : `${+size.value.toFixed(0)} g`
  }
  if (size.kind === 'volume') {
    return size.value >= 1000
      ? `${+(size.value / 1000).toFixed(2)} l`
      : `${+size.value.toFixed(0)} ml`
  }
  return `${size.value} piezas`
}

/** The product's own size: its name first (what people read), then its saved presentation. */
export function savedSize(name: string, quantity: string | null): Size[] {
  const fromName = parseSizes(name)
  return fromName.length > 0 ? fromName : parseSizes(quantity)
}

/**
 * The first size the product and the listing both state but disagree on, or null when they
 * agree or one of them names no size of that kind.
 */
export function sizeMismatch(
  saved: readonly Size[],
  title: string | null | undefined
): { saved: Size; listed: Size } | null {
  const listed = parseSizes(title)
  for (const own of saved) {
    const same = listed.filter((size) => size.kind === own.kind)
    if (same.length === 0) {
      continue
    }
    const matches = same.some((size) => Math.abs(size.value - own.value) <= own.value * TOLERANCE)
    if (!matches) {
      return { saved: own, listed: same[0] }
    }
  }
  return null
}

/** "480 g en MercadoLibre, 510 g guardado", or null when the sizes agree. */
export function sizeNote(
  name: string,
  quantity: string | null,
  title: string | null
): string | null {
  const mismatch = sizeMismatch(savedSize(name, quantity), title)
  return mismatch
    ? `${formatSize(mismatch.listed)} en MercadoLibre, ${formatSize(mismatch.saved)} guardado`
    : null
}
