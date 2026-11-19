import type { OrcaWorkerApi } from 'orca/worker'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { SupplementUpdate } from './backend-client'
import type { MongoLocation, SourceProduct } from './catalog-source'
import { isReferralUrl } from './catalog-status'
import type { CardReading, MeliClient, ReferralResult, SearchResult } from './meli-browser'
import { CatalogDb } from './catalog-db'
import { ScheduleStore } from './schedule-store'
import type { Catalog } from './protocol'
import { field } from './json-fields'
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
  imageUrl: 'https://http2.mlstatic.com/card.webp',
  ...overrides
})

function fakes(database: SourceProduct[]) {
  const writes: SupplementUpdate[][] = []
  const cards = new Map<string, CardReading>()
  const referrals = new Map<string, ReferralResult>()
  const searches = new Map<string, SearchResult[]>()
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
    },
    async search(query) {
      return searches.get(query) ?? []
    }
  }
  const db: { current: CatalogDb | null } = { current: null }
  const deps = {
    catalogSource: (uri: string, _location: MongoLocation) => async (ids?: readonly string[]) => {
      if (uri.includes('unreachable')) {
        throw new Error('querySrv ENOTFOUND')
      }
      return (
        database
          // Like Mongo: a listing is ML-only, named ids come whatever their link.
          .filter((row) =>
            ids ? ids.includes(row.id) : /meli\.la|mercadolibre/.test(row.productURL)
          )
          .map((row) => ({
            ...row,
            linkKind: isReferralUrl(row.productURL) ? ('referido' as const) : ('directo' as const)
          }))
      )
    },
    meli: () => meli,
    openSchedules: () => new ScheduleStore(':memory:'),
    checkout: () => ({
      checkout: async () => ({ stage: 'resumen', total: 1, orderNumber: null, message: 'ok' })
    }),
    fetchImage: async (url: string) =>
      `data:image/webp;base64,${Buffer.from(url).toString('base64')}`,
    openDb: () => {
      db.current = new CatalogDb(':memory:')
      return db.current
    },
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
  return { writes, cards, referrals, searches, deps, db }
}

async function start(database: SourceProduct[], secrets: Record<string, string> = SECRETS) {
  const fake = fakes(database)
  const host = mockHost({ capabilities: CAPABILITIES, secrets, settings: SETTINGS })
  const worker = await mountWorker(
    { default: (orca: OrcaWorkerApi) => activateWith(orca, fake.deps) },
    { host }
  )
  const stored = (): Catalog => ({
    products: fake.db.current?.all() ?? [],
    syncedAt: fake.db.current?.syncedAt() ?? null
  })
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
    stored()
      .products.slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((product) => [product.id, product.sharedCount, product.status]),
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
    'No entra al programa de afiliados (depende del vendedor)'
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

test('bulk referrals propose one per direct link and save only the ones asked for', async () => {
  const first = 'https://www.mercadolibre.com.mx/a/p/MLM1'
  const second = 'https://www.mercadolibre.com.mx/b/p/MLM2'
  const { worker, stored, referrals, cards, writes } = await start([
    source({ id: 'a', productURL: first, linkKind: 'directo' }),
    source({ id: 'b', productURL: second, linkKind: 'directo' }),
    source({ id: 'c' })
  ])
  referrals.set(first, { url: first, referral: 'https://meli.la/a', reason: null })
  cards.set('https://meli.la/a', card('https://meli.la/a'))
  await worker.request('catalog.sync')

  assert.equal((await worker.request('catalog.generateReferrals')).ok, true)
  for (
    let tries = 0;
    tries < 50 &&
    !worker.posts.some(
      (post) => post.event === 'referrals.progress' && field(post.payload, 'running') === false
    );
    tries++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const byId = new Map(stored().products.map((product) => [product.id, product]))
  assert.equal(byId.get('a')?.proposal?.url, 'https://meli.la/a')
  assert.equal(byId.get('b')?.proposal?.url, null)
  assert.equal(
    byId.get('b')?.proposal?.reason,
    'No entra al programa de afiliados (depende del vendedor)'
  )
  assert.equal(byId.get('b')?.status, 'referido_rechazado')
  assert.equal(byId.get('c')?.proposal, null)
  assert.deepEqual(writes, [])

  assert.equal((await worker.request('catalog.applyProposals', { ids: ['a', 'b'] })).ok, true)
  assert.deepEqual(writes, [[{ id: 'a', productURL: 'https://meli.la/a' }]])
})

test('a large catalog fits in the local database with its reading history', async () => {
  const many = Array.from({ length: 1500 }, (_, index) =>
    source({ id: `p${index}`, productURL: `https://meli.la/${index}`, name: 'x'.repeat(300) })
  )
  const { worker, stored, db } = await start(many)
  assert.equal((await worker.request('catalog.sync')).ok, true)
  assert.equal(stored().products.length, 1500)
  await worker.request('catalog.audit', {})
  await settledAudit(worker)
  await worker.request('catalog.audit', {})
  const history = db.current?.history('p7')
  assert.equal(history?.readings.length, 2)
  const page = await worker.request('catalog.view', {
    filter: 'roto',
    search: '',
    sort: { column: 'producto', direction: 'asc' },
    limit: 50
  })
  assert.equal(page.rows.length, 50)
  assert.equal(page.total, 1500)
  assert.equal(page.counts.roto, 1500)
})

test('what older versions kept in the plugin storage moves into the database', async () => {
  const fake = fakes([source()])
  const legacy = {
    syncedAt: 1,
    products: [
      {
        ...source(),
        sharedCount: 1,
        reading: card('https://meli.la/abc'),
        proposal: null,
        status: 'ok',
        diffPct: null
      }
    ]
  }
  const host = mockHost({
    capabilities: CAPABILITIES,
    secrets: SECRETS,
    settings: SETTINGS,
    storage: { catalog: legacy }
  })
  const worker = await mountWorker(
    { default: (orca: OrcaWorkerApi) => activateWith(orca, fake.deps) },
    { host }
  )
  const page = await worker.request('catalog.view', {
    filter: 'todos',
    search: '',
    sort: { column: 'producto', direction: 'asc' },
    limit: 10
  })
  assert.equal(page.rows[0]?.reading?.mlItemId, 'MLM19775686')
  assert.equal(host.data().storage.catalog, undefined)
})

test('referral attempts are kept with their reason', async () => {
  const direct = 'https://www.mercadolibre.com.mx/p/MLM40443067'
  const { worker, db } = await start([source({ productURL: direct, linkKind: 'directo' })])
  await worker.request('catalog.sync')
  await worker.request('catalog.generateReferral', { id: 'p1' })
  await worker.request('catalog.generateReferral', { id: 'p1' })
  const attempts = db.current?.history('p1')?.attempts ?? []
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0]?.reason, 'No entra al programa de afiliados (depende del vendedor)')
})

test('a broken link is repaired from a search result the person picks', async () => {
  const { worker, stored, cards, referrals, searches, writes } = await start([source()])
  const replacement = 'https://www.mercadolibre.com.mx/biotina/p/MLM99'
  searches.set('nutricost biotin', [
    {
      url: replacement,
      title: 'Biotina Nutricost 240 cápsulas',
      price: 380,
      seller: 'Nutricost',
      imageUrl: 'https://http2.mlstatic.com/a.webp'
    }
  ])
  referrals.set(replacement, { url: replacement, referral: 'https://meli.la/fixed', reason: null })
  cards.set('https://meli.la/fixed', card('https://meli.la/fixed'))
  await worker.request('catalog.sync')
  await worker.request('catalog.audit', {})
  await settledAudit(worker)
  assert.equal(stored().products[0]?.status, 'roto')

  const found = await worker.request('catalog.searchReplacement', { id: 'p1' })
  assert.deepEqual(
    found.candidates.map((candidate) => candidate.url),
    [replacement]
  )
  await worker.request('catalog.generateReferral', { id: 'p1', url: replacement })
  assert.equal(stored().products[0]?.proposal?.url, 'https://meli.la/fixed')
  assert.match(found.candidates[0]?.image ?? '', /^data:image\/webp;base64,/)
  assert.match(stored().products[0]?.proposal?.image ?? '', /^data:image\/webp;base64,/)

  assert.equal(stored().products[0]?.status, 'referido_listo')

  const ids = await worker.request('catalog.ids', { scope: 'pendingReferrals' })
  const saved = await worker.request('catalog.applyProposals', { ids })
  assert.deepEqual(writes, [[{ id: 'p1', productURL: 'https://meli.la/fixed' }]])
  assert.match(saved.message, /Verificando/)
  // Saving reads the new link again: «Al día» or «Cambio de precio» means it took.
  for (let tries = 0; tries < 50 && stored().products[0]?.status === 'sin_revisar'; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(stored().products[0]?.status, 'precio_cambio')
  assert.equal(stored().products[0]?.productURL, 'https://meli.la/fixed')
})

test('bulk repair proposes only search results of the same brand', async () => {
  const { worker, stored, cards, referrals, searches } = await start([
    source({ id: 'a', productURL: 'https://meli.la/a' }),
    source({ id: 'b', productURL: 'https://meli.la/b', brand: 'gnc', name: 'zinc' }),
    // Same brand, another product: never proposed.
    source({ id: 'c', productURL: 'https://meli.la/c', brand: 'Matter', name: 'Ka 30' })
  ])
  const same = 'https://www.mercadolibre.com.mx/biotina/p/MLM1'
  searches.set('nutricost biotin', [
    {
      url: 'https://www.mercadolibre.com.mx/otra/p/MLM0',
      title: 'Biotina Genérica',
      price: 1,
      seller: null,
      imageUrl: null
    },
    { url: same, title: 'Biotina Nutricost 240', price: 2, seller: null, imageUrl: null }
  ])
  searches.set('Matter Ka 30', [
    {
      url: 'https://www.mercadolibre.com.mx/ossforte/p/MLM3',
      title: 'Matter Ossforte Colageno 30 Porciones',
      price: 4,
      seller: null,
      imageUrl: null
    }
  ])
  searches.set('gnc zinc', [
    {
      url: 'https://www.mercadolibre.com.mx/zinc/p/MLM2',
      title: 'Zinc Nature Made',
      price: 3,
      seller: null,
      imageUrl: null
    }
  ])
  referrals.set(same, { url: same, referral: 'https://meli.la/new-a', reason: null })
  cards.set('https://meli.la/new-a', card('https://meli.la/new-a'))
  await worker.request('catalog.sync')
  await worker.request('catalog.audit', {})
  await settledAudit(worker)

  assert.equal((await worker.request('catalog.proposeReplacements')).ok, true)
  for (
    let tries = 0;
    tries < 50 &&
    !worker.posts.some(
      (post) => post.event === 'repairs.progress' && field(post.payload, 'running') === false
    );
    tries++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const byId = new Map(stored().products.map((product) => [product.id, product]))
  assert.equal(byId.get('a')?.proposal?.url, 'https://meli.la/new-a')
  assert.equal(byId.get('b')?.proposal, null)
  assert.equal(byId.get('c')?.proposal, null)
})

test('«Usar este» writes the new referral and its price in one step', async () => {
  const { worker, stored, cards, referrals, writes } = await start([source()])
  const replacement = 'https://www.mercadolibre.com.mx/biotina/p/MLM99'
  referrals.set(replacement, { url: replacement, referral: 'https://meli.la/fixed', reason: null })
  cards.set(
    'https://meli.la/fixed',
    card('https://meli.la/fixed', { price: 380, listPrice: 420, discountPercentage: 10 })
  )
  await worker.request('catalog.sync')

  const result = await worker.request('catalog.replaceLink', { id: 'p1', url: replacement })
  assert.equal(result.ok, true)
  assert.match(result.message, /\$380/)
  assert.deepEqual(writes, [
    [
      {
        id: 'p1',
        price: 380,
        priceCheckedAt: '2026-11-18T00:00:00.000Z',
        listPrice: 420,
        discountPercentage: 10,
        mlItemId: 'MLM19775686',
        productURL: 'https://meli.la/fixed'
      }
    ]
  ])
  const [saved] = stored().products
  assert.equal(saved.productURL, 'https://meli.la/fixed')
  assert.equal(saved.price, 380)
  assert.equal(saved.status, 'ok')
})

test('«Usar este» writes nothing when MercadoLibre refuses the referral', async () => {
  const { worker, stored, writes } = await start([source()])
  await worker.request('catalog.sync')
  const result = await worker.request('catalog.replaceLink', {
    id: 'p1',
    url: 'https://www.mercadolibre.com.mx/otra/p/MLM5'
  })
  assert.equal(result.ok, false)
  assert.equal(result.message, 'No entra al programa de afiliados (depende del vendedor)')
  assert.deepEqual(writes, [])
  assert.equal(stored().products[0]?.productURL, 'https://meli.la/abc')
})

test('«Usar este» gives a product sold in its own store its first ML link', async () => {
  const { worker, stored, cards, referrals, writes } = await start([
    source(),
    source({
      id: 'store',
      productURL: 'https://blife.mx/products/psyllium',
      linkKind: 'directo',
      name: 'psyllium husk fiber',
      price: 349
    })
  ])
  await worker.request('catalog.sync')
  assert.equal(
    stored().products.some((p) => p.id === 'store'),
    false
  )

  const listing = 'https://www.mercadolibre.com.mx/psyllium/p/MLM7'
  referrals.set(listing, { url: listing, referral: 'https://meli.la/psy', reason: null })
  cards.set(
    'https://meli.la/psy',
    card('https://meli.la/psy', {
      price: 327.18,
      listPrice: null,
      discountPercentage: null,
      title: 'Fibra de Psyllium Husk Nutricost 240'
    })
  )
  const result = await worker.request('catalog.replaceLink', { id: 'store', url: listing })
  assert.equal(result.ok, true)
  assert.equal(writes.at(-1)?.[0]?.productURL, 'https://meli.la/psy')
  const joined = stored().products.find((p) => p.id === 'store')
  assert.equal(joined?.productURL, 'https://meli.la/psy')
  assert.equal(joined?.price, 327.18)
})

test('a task run now through the scheduler lands in the history', async () => {
  const { worker } = await start([source()])
  await worker.request('catalog.sync')
  const saved = await worker.request('schedules.save', {
    kind: 'sync',
    days: [1, 3, 5],
    time: '07:00',
    enabled: true,
    mode: 'prueba'
  })
  assert.equal(saved.ok, true)
  await worker.request('schedules.runNow', { kind: 'sync', mode: 'prueba' })
  let state = await worker.request('schedules.state')
  for (let tries = 0; tries < 50 && state.runs[0]?.finishedAt == null; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    state = await worker.request('schedules.state')
  }
  assert.equal(state.schedules[0]?.kind, 'sync')
  assert.ok(state.schedules[0]?.nextRunAt)
  assert.equal(state.runs[0]?.ok, true)
  assert.match(state.runs[0]?.summary ?? '', /1 suplementos/)
})
