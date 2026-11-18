import type { OrcaWorkerApi } from 'orca/worker'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { SupplementUpdate } from './backend-client'
import type { MongoLocation, SourceProduct } from './catalog-source'
import { isReferralUrl } from './catalog-status'
import type { CardReading, MeliClient, ReferralResult } from './meli-browser'
import type { Catalog } from './protocol'
import { field, isCatalog } from './json-fields'
import { activateWith } from './worker'

const CAPABILITIES = ['storage:own', 'secrets:own', 'settings:own']
const SETTINGS = {
  backendUrl: 'https://api.ejemplo.com',
  backendPricesPath: '/api/prices',
  mongoDatabase: 'catalogo',
  mongoCollection: 'productos',
  catalogOwner: 'acme'
}
const SECRETS = {
  mongoUri: 'mongodb+srv://reader',
  backendEmail: 'admin@ejemplo.com',
  backendPassword: 'secret'
}

const source = (overrides: Partial<SourceProduct> = {}): SourceProduct => ({
  id: 'p1',
  name: 'biotin',
  brand: 'nutricost',
  owner: 'acme',
  quantity: '240 cápsulas',
  flavor: null,
  productURL: 'https://meli.la/abc',
  linkKind: 'referido',
  price: 400,
  listPrice: null,
  discountPercentage: null,
  mlItemId: null,
  priceCheckedAt: null,
  hasStock: true,
  margin: 10,
  ...overrides
})

const card = (url: string, overrides: Partial<CardReading> = {}): CardReading => ({
  url,
  ok: true,
  checkedAt: Date.UTC(2026, 10, 18),
  price: 373,
  listPrice: 395,
  discountPercentage: 5,
  title: 'Biotina Nutricost en cápsula 240 un',
  seller: 'Nutricost',
  mlItemId: 'MLM19775686',
  ...overrides
})

function fakes(database: SourceProduct[]) {
  const writes: SupplementUpdate[][] = []
  const cards = new Map<string, CardReading>()
  const referrals = new Map<string, ReferralResult>()
  const meli: MeliClient = {
    async readCards(urls, onBatch) {
      await onBatch(urls.map((url) => cards.get(url) ?? card(url, { ok: false, price: null })))
    },
    async generateReferrals(urls) {
      return urls.map(
        (url) =>
          referrals.get(url) ?? {
            url,
            referral: null,
            reason: 'Este producto no cumple con los requisitos del Programa.'
          }
      )
    },
    async canonicalUrl() {
      return { status: 404, canonical: null, unavailable: false }
    }
  }
  const deps = {
    catalogSource: (uri: string, _location: MongoLocation) => async (ids?: readonly string[]) => {
      if (uri.includes('unreachable')) {
        throw new Error('querySrv ENOTFOUND')
      }
      return database
        .filter((row) => !ids || ids.includes(row.id))
        .map((row) => ({
          ...row,
          linkKind: isReferralUrl(row.productURL) ? ('referido' as const) : ('directo' as const)
        }))
    },
    meli: () => meli,
    async patch(_credentials: unknown, updates: readonly SupplementUpdate[]) {
      writes.push([...updates])
      for (const update of updates) {
        const row = database.find((candidate) => candidate.id === update.id)
        if (row) {
          Object.assign(row, update)
        }
      }
      return updates
    }
  }
  return { writes, cards, referrals, deps }
}

async function start(database: SourceProduct[], secrets: Record<string, string> = SECRETS) {
  const fake = fakes(database)
  const host = mockHost({ capabilities: CAPABILITIES, secrets, settings: SETTINGS })
  const worker = await mountWorker(
    { default: (orca: OrcaWorkerApi) => activateWith(orca, fake.deps) },
    { host }
  )
  const stored = (): Catalog => {
    const value = host.data().storage.catalog
    if (!isCatalog(value)) {
      throw new Error('no catalog stored')
    }
    return value
  }
  return { ...fake, host, worker, stored }
}

async function settledAudit(worker: Awaited<ReturnType<typeof mountWorker>>): Promise<void> {
  for (
    let tries = 0;
    tries < 50 &&
    !worker.posts.some(
      (post) => post.event === 'audit.progress' && field(post.payload, 'running') === false
    );
    tries++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('sync loads the catalog and counts links shared by two products', async () => {
  const { worker, stored } = await start([
    source(),
    source({ id: 'p2', name: 'biotin vanilla' }),
    source({ id: 'p3', productURL: 'https://www.mercadolibre.com.mx/p/MLM1', linkKind: 'directo' })
  ])
  const result = await worker.request('catalog.sync')
  assert.equal(result.ok, true)
  assert.deepEqual(
    stored().products.map((product) => [product.id, product.sharedCount, product.status]),
    [
      ['p1', 2, 'sin_revisar'],
      ['p2', 2, 'sin_revisar'],
      ['p3', 1, 'link_directo']
    ]
  )
})

test('sync without a Mongo connection says what is missing', async () => {
  const { worker } = await start([source()], {})
  const result = await worker.request('catalog.sync')
  assert.equal(result.ok, false)
  assert.match(result.message, /Mongo/)
})

test('audit stores each reading and the price applies through the backend', async () => {
  const database = [source()]
  const { worker, stored, cards, writes } = await start(database)
  cards.set('https://meli.la/abc', card('https://meli.la/abc'))
  await worker.request('catalog.sync')
  assert.equal((await worker.request('catalog.audit', {})).ok, true)
  await settledAudit(worker)
  const [read] = stored().products
  assert.equal(read.status, 'precio_cambio')
  assert.equal(read.diffPct, -6.7)

  assert.equal((await worker.request('catalog.applyPrices', { ids: ['p1'] })).ok, true)
  assert.deepEqual(writes, [
    [
      {
        id: 'p1',
        price: 373,
        priceCheckedAt: '2026-11-18T00:00:00.000Z',
        listPrice: 395,
        discountPercentage: 5,
        mlItemId: 'MLM19775686'
      }
    ]
  ])
  assert.equal(stored().products[0].price, 373)
  assert.equal(stored().products[0].status, 'ok')
})

test('a referral is only a proposal until it is saved, and saving resets the reading', async () => {
  const direct = 'https://www.mercadolibre.com.mx/biotina/p/MLM19775686'
  const { worker, stored, cards, referrals, writes } = await start([
    source({ productURL: direct, linkKind: 'directo' })
  ])
  referrals.set(direct, { url: direct, referral: 'https://meli.la/new', reason: null })
  cards.set('https://meli.la/new', card('https://meli.la/new'))
  await worker.request('catalog.sync')

  const generated = await worker.request('catalog.generateReferral', { id: 'p1' })
  assert.equal(generated.ok, true)
  assert.equal(stored().products[0].proposal?.url, 'https://meli.la/new')
  assert.deepEqual(writes, [])

  await worker.request('catalog.applyUrl', { id: 'p1', url: 'https://meli.la/new' })
  assert.deepEqual(writes, [[{ id: 'p1', productURL: 'https://meli.la/new' }]])
  const [saved] = stored().products
  assert.equal(saved.linkKind, 'referido')
  assert.equal(saved.status, 'sin_revisar')
  assert.equal(saved.proposal, null)
})

test('a rejected referral keeps the reason ML gave', async () => {
  const direct = 'https://www.mercadolibre.com.mx/p/MLM40443067'
  const { worker, stored } = await start([source({ productURL: direct, linkKind: 'directo' })])
  await worker.request('catalog.sync')
  const result = await worker.request('catalog.generateReferral', { id: 'p1' })
  assert.equal(result.ok, false)
  assert.equal(
    stored().products[0].proposal?.reason,
    'Este producto no cumple con los requisitos del Programa.'
  )
})

test('refuses URLs outside MercadoLibre and writes without admin credentials', async () => {
  const { worker, writes } = await start([source()], { mongoUri: 'mongodb+srv://reader' })
  await worker.request('catalog.sync')
  assert.equal(
    (await worker.request('catalog.applyUrl', { id: 'p1', url: 'https://amazon.com.mx/x' })).ok,
    false
  )
  const stock = await worker.request('catalog.setStock', { id: 'p1', hasStock: false })
  assert.equal(stock.ok, false)
  assert.match(stock.message, /admin/)
  assert.deepEqual(writes, [])
})

test('a Mongo URI that cannot connect never replaces the one that works', async () => {
  const { worker, host } = await start([source()])
  const saved = await worker.request('connection.save', {
    mongoUri: 'mongodb+srv://reader:x@unreachable.mongodb.net/'
  })
  assert.equal(saved.result.ok, false)
  assert.match(saved.result.message, /ENOTFOUND/)
  assert.equal(host.data().secrets.mongoUri, SECRETS.mongoUri)
})

test('a node host pasted from Atlas is saved as the cluster host', async () => {
  const { worker, host } = await start([source()], {})
  const saved = await worker.request('connection.save', {
    mongoUri: 'mongodb+srv://reader:x@cluster0-shard-00-01.abcde.mongodb.net:27017/'
  })
  assert.equal(saved.result.ok, true)
  assert.equal(host.data().secrets.mongoUri, 'mongodb+srv://reader:x@cluster0.abcde.mongodb.net/')
})

test('without the Mongo location nothing is read, and the panel is told what to fill in', async () => {
  const fake = fakes([source()])
  const host = mockHost({
    capabilities: CAPABILITIES,
    secrets: SECRETS,
    settings: { mongoDatabase: 'catalogo' }
  })
  const worker = await mountWorker(
    { default: (orca: OrcaWorkerApi) => activateWith(orca, fake.deps) },
    { host }
  )
  const result = await worker.request('catalog.sync')
  assert.equal(result.ok, false)
  assert.match(result.message, /colección/)
  assert.equal((await worker.request('connection.status')).mongo, false)
})

test('saving the configuration stores it in the plugin settings', async () => {
  const { worker, host } = await start([source()])
  await worker.request('connection.save', { config: { catalogOwner: ' otra-marca ' } })
  assert.equal(host.data().settings.catalogOwner, 'otra-marca')
})
