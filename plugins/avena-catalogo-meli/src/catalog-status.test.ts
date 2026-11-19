import { assert, describe, test } from 'orca/testing'
import {
  brandMatches,
  classify,
  isApplicable,
  isPriceUpdate,
  nameMatches,
  pricePayload,
  priceDiffPct,
  withStatus
} from './catalog-status'
import type { MeliReading, Product } from './protocol'

const reading = (overrides: Partial<MeliReading> = {}): MeliReading => ({
  ok: true,
  checkedAt: Date.UTC(2026, 10, 18),
  price: 100,
  listPrice: null,
  discountPercentage: null,
  title: 'Biotina Nutricost 240 cápsulas',
  seller: 'Nutricost',
  mlItemId: 'MLM19775686',
  ...overrides
})

const product = (overrides: Partial<Product> = {}): Product =>
  withStatus({
    id: 'p1',
    name: 'biotin',
    brand: 'nutricost',
    owner: 'acme',
    quantity: null,
    flavor: null,
    productURL: 'https://meli.la/abc',
    linkKind: 'referido',
    sharedCount: 1,
    price: 100,
    listPrice: null,
    discountPercentage: null,
    mlItemId: null,
    priceCheckedAt: null,
    hasStock: true,
    margin: 10,
    reading: reading(),
    proposal: null,
    status: 'sin_revisar',
    diffPct: null,
    ...overrides
  })

describe('classify', () => {
  test('direct links come first: they earn no commission', () => {
    assert.equal(
      classify(
        product({ linkKind: 'directo', productURL: 'https://www.mercadolibre.com.mx/p/MLM1' })
      ),
      'link_directo'
    )
  })

  test('a direct link MercadoLibre refused keeps its own status', () => {
    const rejected = product({
      linkKind: 'directo',
      proposal: { url: null, reason: 'La publicación está pausada', title: null, createdAt: 1 }
    })
    assert.equal(classify(rejected), 'referido_rechazado')
  })

  test('an unread link waits for a reading, a missing card is broken', () => {
    assert.equal(classify(product({ reading: null })), 'sin_revisar')
    assert.equal(classify(product({ reading: reading({ ok: false, price: null }) })), 'roto')
  })

  test('shared links and other brands need a person before any price is written', () => {
    assert.equal(classify(product({ sharedCount: 2 })), 'link_compartido')
    assert.equal(
      classify(product({ reading: reading({ title: 'Melatonina Natrol 90 gomitas' }) })),
      'revisar_identidad'
    )
  })

  test('price buckets: within 1% is current, past 50% is a jump to review', () => {
    assert.equal(classify(product({ price: 100.5 })), 'ok')
    assert.equal(classify(product({ price: 110 })), 'precio_cambio')
    assert.equal(classify(product({ price: 60 })), 'revisar_salto')
    assert.equal(classify(product({ price: null })), 'sin_precio_base')
  })
})

test('brand aliases cover catalog spellings ML never uses', () => {
  assert.equal(brandMatches('sasha fitness', 'Proteína Sascha Fitness Hydrolyzed'), true)
  assert.equal(brandMatches('B Life', 'Multivitamínico Para Mujer 180 Cáps B Life'), true)
  assert.equal(brandMatches('gnc', 'Gluconato de zinc Nature Made'), false)
})

test('the difference is relative to the saved price, one decimal', () => {
  assert.equal(priceDiffPct(341, reading({ price: 615.12 })), 80.4)
  assert.equal(priceDiffPct(null, reading()), null)
})

describe('pricePayload', () => {
  test('carries the offer context with the price the client pays', () => {
    assert.deepEqual(
      pricePayload(
        product({ reading: reading({ price: 615.12, listPrice: 699, discountPercentage: 12 }) })
      ),
      {
        id: 'p1',
        price: 615.12,
        priceCheckedAt: '2026-11-18T00:00:00.000Z',
        listPrice: 699,
        discountPercentage: 12,
        mlItemId: 'MLM19775686'
      }
    )
  })

  test('drops a list price that is not above the paid price (a misread struck-through amount)', () => {
    const payload = pricePayload(
      product({ reading: reading({ price: 4000, listPrice: 1114, discountPercentage: 72 }) })
    )
    assert.equal(payload?.listPrice, undefined)
    assert.equal(payload?.discountPercentage, undefined)
  })

  test('nothing to write without a live reading', () => {
    assert.equal(pricePayload(product({ reading: reading({ ok: false, price: null }) })), null)
  })
})

test('a same-brand result only counts when it names the product too', () => {
  assert.equal(nameMatches('Matter', 'Ka 30', 'Matter Ossforte Colageno 30 Porciones'), false)
  assert.equal(nameMatches('Matter', 'Ka 30', 'Matter Ka 30 Colágeno 30 sobres'), true)
  assert.equal(nameMatches('nutricost', 'biotin', 'Biotina Nutricost 240 cápsulas'), true)
})

test('a shared link with another ML price is applied with the price changes', () => {
  assert.equal(
    isApplicable(product({ sharedCount: 2, price: 1199.45, reading: reading({ price: 846 }) })),
    true
  )
  assert.equal(
    isApplicable(product({ sharedCount: 2, price: 846, reading: reading({ price: 846 }) })),
    false
  )
  assert.equal(isApplicable(product({ price: 60 })), false)
})

test('a listing of another size is its own status, ahead of a shared link', () => {
  const bigger = product({
    name: 'falcon performance choco bronze 722 g',
    brand: 'birdman',
    sharedCount: 2,
    price: 846,
    reading: reading({ price: 846, title: 'Birdman Falcon Performance | Chocolate | 1.14kg' })
  })
  assert.equal(classify(bigger), 'otra_presentacion')
  assert.equal(isApplicable(bigger), false)
})

test('the scheduled price update also follows big jumps up, never big drops', () => {
  const up = product({ price: 424.15, reading: reading({ price: 900 }) })
  const down = product({ price: 900, reading: reading({ price: 300 }) })
  assert.equal(up.status, 'revisar_salto')
  assert.equal(down.status, 'revisar_salto')
  assert.equal(isPriceUpdate(up), true)
  assert.equal(isPriceUpdate(down), false)
  assert.equal(isPriceUpdate(product({ price: 100, reading: reading({ price: 110 }) })), true)
  assert.equal(isPriceUpdate(product({ price: 100 })), false)
})
