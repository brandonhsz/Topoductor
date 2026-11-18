// A small audited catalog for the panel's checks, tests and shots.
import { withStatus } from './catalog-status'
import type { Catalog, MeliReading, Product } from './protocol'

const checkedAt = Date.UTC(2026, 10, 18, 19)

function reading(price: number | null, extra: Partial<MeliReading> = {}): MeliReading {
  return {
    ok: price !== null,
    checkedAt,
    price,
    listPrice: null,
    discountPercentage: null,
    title: null,
    seller: null,
    mlItemId: null,
    ...extra
  }
}

function product(
  id: string,
  brand: string,
  name: string,
  price: number | null,
  extra: Partial<Product> = {}
): Product {
  return withStatus({
    id,
    name,
    brand,
    owner: 'acme',
    quantity: null,
    flavor: null,
    productURL: `https://meli.la/${id}`,
    linkKind: 'referido',
    sharedCount: 1,
    price,
    listPrice: null,
    discountPercentage: null,
    mlItemId: null,
    priceCheckedAt: null,
    hasStock: true,
    margin: 10,
    reading: null,
    proposal: null,
    status: 'sin_revisar',
    diffPct: null,
    ...extra
  })
}

export const REVIEW_FIXTURE = {
  syncedAt: checkedAt,
  products: [
    product('mult', 'B Life', 'Womens Mult Matur3', 341, {
      reading: reading(615.12, {
        listPrice: 699,
        discountPercentage: 12,
        title: 'Multivitamínico Para Mujer 180 Cáps B Life',
        mlItemId: 'MLM18757890'
      })
    }),
    product('biotin', 'nutricost', 'biotin vitamina b7', 400, {
      reading: reading(373, {
        listPrice: 395,
        discountPercentage: 5,
        title: 'Biotina Nutricost 240 un',
        seller: 'Nutricost'
      })
    }),
    product('kids', 'B Life', 'Gomitas Mult Blend Kids', 289, { reading: reading(null) }),
    product('omega', 'Acme Health', 'Omega 3 Salmon', 489, {
      productURL: 'https://www.mercadolibre.com.mx/p/MLM3699398069',
      linkKind: 'directo'
    }),
    product('ok', 'natrol', 'melatonin', 220, {
      reading: reading(220, { title: 'Melatonina Natrol 90 gomitas' })
    })
  ]
} satisfies Catalog
