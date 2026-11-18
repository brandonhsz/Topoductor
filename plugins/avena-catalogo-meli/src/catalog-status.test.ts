import { assert, describe, test } from 'orca/testing'
import { brandMatches, classify, pricePayload, priceDiffPct, withStatus } from './catalog-status'
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
