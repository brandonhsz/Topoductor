import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { REVIEW_FIXTURE } from './panel-fixture'

const CONFIG = {
  backendUrl: 'https://api.ejemplo.com',
  backendPricesPath: '/api/prices',
  mongoDatabase: 'catalogo',
  mongoCollection: 'productos',
  catalogOwner: 'acme'
}
const CONNECTED = { mongo: true, backend: true, config: CONFIG }

test('asks for connections before anything else', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    requests: {
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
    storage: { catalog: REVIEW_FIXTURE },
    requests: {
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
    storage: { catalog: REVIEW_FIXTURE },
    requests: {
      'connection.status': () => CONNECTED,
      'catalog.applyPrices': ({ ids }) => {
        applied.push(ids)
        return { ok: true, message: 'ok' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: 'Aplicar 1 cambios de precio seguros' })
  assert.deepEqual(applied, [])
  await view.press({ text: 'Confirmar 1 precios' })
  // The 80% jump (mult) waits for a person.
  assert.deepEqual(applied, [['biotin']])
})

test('filters to the products whose link earns commission', async () => {
  const host = mockHost({
    capabilities: ['storage:own'],
    storage: { catalog: REVIEW_FIXTURE },
    requests: { 'connection.status': () => CONNECTED }
  })
  const view = await mount(panel, { host })
  await view.select({ type: 'Select' }, 'con_referido')
  assert.deepEqual(view.rowsOf({ type: 'Table' }), ['kids', 'mult', 'ok', 'biotin'])
})
