import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { CatalogDb } from './catalog-db'
import { REVIEW_FIXTURE } from './panel-fixture'
import type { BulkScope } from './protocol'

const CONFIG = {
  backendUrl: 'https://api.ejemplo.com',
  backendPricesPath: '/api/prices',
  mongoDatabase: 'catalogo',
  mongoCollection: 'productos',
  catalogOwner: 'acme'
}
const CONNECTED = { mongo: true, backend: true, config: CONFIG }

/** The worker's catalog requests, answered by an in-memory database holding the fixture. */
function catalogRequests() {
  const db = new CatalogDb(':memory:')
  db.save(REVIEW_FIXTURE.products, { syncedAt: REVIEW_FIXTURE.syncedAt })
  return {
    'catalog.view': (query: Parameters<CatalogDb['view']>[0]) => db.view(query),
    'catalog.history': ({ id }: { id: string }) => db.history(id),
    'catalog.ids': ({ scope }: { scope: BulkScope }) => db.ids(scope)
  }
}

test('asks for connections before anything else', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      'catalog.view': () => ({
        rows: [],
        total: 0,
        counts: {},
        syncedAt: null,
        all: 0,
        withReferral: 0,
        direct: 0,
        applicable: 0,
        pendingReferrals: 0,
        withNewPrice: 0
      }),
      'connection.status': () => ({
        mongo: false,
        backend: false,
        config: CONFIG
      })
    }
  })
  const view = await mount(panel, { host })
  assert.deepEqual(view.summary(), [
    'Heading "Catálogo MercadoLibre"',
    'Callout warning "Faltan conexiones"',
    'EmptyState "Sin catálogo cargado"'
  ])
  assert.deepEqual(view.errors, [])
})

test('lists what needs review and applies one price from the detail', async () => {
  const applied: string[][] = []
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      ...catalogRequests(),
      'connection.status': () => CONNECTED,
      'catalog.applyPrices': ({ ids }) => {
        applied.push(ids)
        return { ok: true, message: '1 precio(s) guardado(s) en la base.' }
      }
    }
  })
  const view = await mount(panel, { host })
  // The default filter hides the product already at its ML price; rows sort by brand and name.
  assert.deepEqual(view.rowsOf({ type: 'Table' }), ['omega', 'kids', 'mult', 'biotin'])

  await view.selectRows({ type: 'Table' }, ['biotin'])
  await view.press({ text: 'Aplicar $373' })
  assert.deepEqual(applied, [['biotin']])
  assert.ok(view.summary().some((line) => line.startsWith('Callout success')))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('bulk apply asks to confirm and sends only the safe price changes', async () => {
  const applied: string[][] = []
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      ...catalogRequests(),
      'connection.status': () => CONNECTED,
      'catalog.applyPrices': ({ ids }) => {
        applied.push(ids)
        return { ok: true, message: 'ok' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: 'Aplicar 1 cambios de precio' })
  assert.deepEqual(applied, [])
  await view.press({ text: 'Confirmar 1 precios' })
  // The 80% jump (mult) waits for a person.
  assert.deepEqual(applied, [['biotin']])
})

test('filters to the products whose link earns commission', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: { ...catalogRequests(), 'connection.status': () => CONNECTED }
  })
  const view = await mount(panel, { host })
  await view.select({ type: 'Select' }, 'con_referido')
  assert.deepEqual(view.rowsOf({ type: 'Table' }), ['kids', 'mult', 'ok', 'biotin'])
})

test('each status chip explains itself on hover and filters on press', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: { ...catalogRequests(), 'connection.status': () => CONNECTED }
  })
  const view = await mount(panel, { host })
  const chip = view.find({ text: 'Link roto (1)' })
  assert.match(String(chip?.props.tooltip), /lista genérica/)
  await view.press({ text: 'Link roto (1)' })
  assert.deepEqual(view.rowsOf({ type: 'Table' }), ['kids'])
})

test('a broken link offers to search MercadoLibre for a replacement', async () => {
  const replaced: string[] = []
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      ...catalogRequests(),
      'connection.status': () => CONNECTED,
      'catalog.replaceLink': ({ id }: { id: string }) => {
        replaced.push(id)
        return { ok: true, message: 'Link reemplazado' }
      },
      'catalog.searchReplacement': () => ({
        ok: true,
        message: '1 resultados',
        candidates: [
          {
            // Real listing URLs can run past Topo's 1 KiB cap on keys.
            url: `https://www.mercadolibre.com.mx/${'x'.repeat(1200)}/p/MLM1`,
            title: 'Gomitas B Life Kids',
            price: 289,
            seller: 'B Life',
            image: 'data:image/webp;base64,UklGRg=='
          }
        ]
      })
    }
  })
  const view = await mount(panel, { host })
  await view.selectRows({ type: 'Table' }, ['kids'])
  await view.press({ text: 'Buscar reemplazo' })
  assert.ok(view.find({ text: 'Gomitas B Life Kids' }))
  assert.equal(view.findAll({ type: 'Image' }).length, 1)
  assert.ok(view.find({ text: 'Usar este' }))
  await view.press({ text: 'Usar este' })
  assert.deepEqual(replaced, ['kids'])
  assert.deepEqual(view.errors, [])
})

test('the detail never shows a history that is not the selected row', async () => {
  const requests = catalogRequests()
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      ...requests,
      'connection.status': () => CONNECTED,
      // A late answer for an earlier click: the history of another product.
      'catalog.history': () => requests['catalog.history']({ id: 'mult' })
    }
  })
  const view = await mount(panel, { host })
  await view.selectRows({ type: 'Table' }, ['biotin'])
  assert.equal(view.find({ text: /Aplicar \$615/ }), null)
  assert.equal(view.findAll({ type: 'Card' }).length, 0)
})

test('applies every new ML price after a warning that names the ones to review', async () => {
  const applied: string[][] = []
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
      ...catalogRequests(),
      'connection.status': () => CONNECTED,
      'catalog.applyPrices': ({ ids }: { ids: string[] }) => {
        applied.push(ids)
        return { ok: true, message: 'ok' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: 'Aplicar precios de ML a todos (2)' })
  assert.ok(view.summary().some((line) => line.includes('¿Aplicar 2 precios?')))
  assert.ok(view.find({ text: /Incluye 1 productos que piden revisión/ }))
  await view.press({ text: 'Confirmar 2 precios' })
  // The 80% jump goes too; the broken link, the direct one and the current price do not.
  assert.deepEqual(
    applied.map((ids) => ids.slice().sort()),
    [['biotin', 'mult']]
  )
})
