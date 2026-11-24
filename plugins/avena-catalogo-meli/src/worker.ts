// The plugin's worker: keeps the catalog in a local SQLite database, reads ML through
// Topo's browser, and writes through the configured backend.
import type { OrcaWorkerApi } from 'orca/worker'
import { patchSupplements, type BackendCredentials, type SupplementUpdate } from './backend-client'
import { mongoCatalogSource, type CatalogSource, type MongoLocation } from './catalog-source'
import { backendCredentials, mongoLocation, readCatalogConfig } from './catalog-config'
import { isMeliUrl, isReferralUrl, pricePayload, withStatus } from './catalog-status'
import { CatalogDb } from './catalog-db'
import { CheckoutBrowser, type CheckoutClient, type CheckoutOptions } from './checkout-browser'
import { withLocalPanels } from './local-panels'
import { ScheduleStore } from './schedule-store'
import { wireSchedules } from './schedule-wiring'
import { FlowQueue, SqliteFlowLock, type LockStore } from './flow-queue'
import { queuedMeli } from './meli-queue'
import { imageFetcher, type ImageFetcher } from './image-data'
import { CatalogRepository, type OpenCatalogDb } from './catalog-repository'
import { cliRunner, MeliBrowser, type MeliClient } from './meli-browser'
import { fromSource, sharedCounts } from './catalog-merge'
import { registerConnectionHandlers } from './connection-handlers'
import { registerReferralHandlers } from './referral-handlers'
import type { ActionResult, Catalog, CatalogConfig, Product } from './protocol'

export type WorkerDeps = {
  catalogSource(uri: string, location: MongoLocation): CatalogSource
  meli(cliPath: string, workspace?: string, profile?: string): MeliClient
  patch(credentials: BackendCredentials, updates: readonly SupplementUpdate[]): Promise<unknown>
  openDb: OpenCatalogDb
  fetchImage: ImageFetcher
  openSchedules(path: string): ScheduleStore
  openLock(path: string): LockStore
  checkout(cliPath: string, options: CheckoutOptions, workspace?: string): CheckoutClient
}

const DEFAULT_CLI = '/Applications/Topo.app/Contents/Resources/bin/topo'

const realDeps: WorkerDeps = {
  catalogSource: mongoCatalogSource,
  meli: (cliPath, workspace, profile) => new MeliBrowser(cliRunner(cliPath), workspace, profile),
  patch: patchSupplements,
  openDb: (path) => new CatalogDb(path),
  fetchImage: imageFetcher(),
  openSchedules: (path) => new ScheduleStore(path),
  openLock: (path) => new SqliteFlowLock(path),
  checkout: (cliPath, options, workspace) =>
    new CheckoutBrowser(new MeliBrowser(cliRunner(cliPath), workspace), options)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function activateWith(rawOrca: OrcaWorkerApi, deps: WorkerDeps): void {
  // Scheduled tasks reuse the panel's handlers and progress posts in-process.
  const { orca, call, bus } = withLocalPanels(rawOrca)
  let auditRunning = false

  const repository = new CatalogRepository(orca, deps.openDb)

  async function catalog(): Promise<Catalog> {
    const db = await repository.database()
    return { products: db.all(), syncedAt: db.syncedAt() }
  }

  const saveProducts = (change: (products: Product[]) => Product[]): Promise<void> =>
    repository.update(change)

  async function mongoSource(): Promise<CatalogSource> {
    const uri = await orca.secrets.get('mongoUri')
    if (!uri) {
      throw new Error('Falta la conexión a Mongo: agrégala en Conexiones.')
    }
    return deps.catalogSource(uri, mongoLocation(await config()))
  }

  const backend = (): Promise<BackendCredentials> => backendCredentials(orca)
  const config = (): Promise<CatalogConfig> => readCatalogConfig(orca)

  async function cliPath(): Promise<string> {
    const configured = await orca.settings.get('topoCli')
    return String(configured || process.env.TOPO_CLI_COMMAND || DEFAULT_CLI)
  }
  const workspace = async (): Promise<string> =>
    String((await orca.settings.get('browserWorkspace')) ?? '')
  const profile = async (): Promise<string> =>
    String((await orca.settings.get('browserProfile')) ?? '')
  let lock: Promise<LockStore> | null = null
  const queue = new FlowQueue(() => (lock ??= repository.path().then(deps.openLock)), {
    changed: () => orca.panels.post('schedules.changed', { at: Date.now() })
  })
  const meli = async (): Promise<MeliClient> =>
    queuedMeli(deps.meli(await cliPath(), await workspace(), await profile()), queue)

  /** Re-reads `ids` from Mongo after a write, so the panel shows what the database holds. */
  async function refresh(ids: readonly string[]): Promise<void> {
    const fresh = new Map(
      (await (await mongoSource())(ids)).map((product) => [product.id, product])
    )
    await saveProducts((products) => {
      // A product that just got its first ML link joins the catalog.
      const joining = [...fresh.values()].filter(
        (source) => isMeliUrl(source.productURL) && !products.some((p) => p.id === source.id)
      )
      const all = [...products, ...joining.map((source) => fromSource(source, undefined, 1))]
      const counts = sharedCounts(all.map((product) => fresh.get(product.id) ?? product))
      return all.map((product) => {
        const source = fresh.get(product.id) ?? product
        return fromSource(source, product, counts.get(source.productURL) ?? 1)
      })
    })
  }

  /** A product of the catalog, or of the owner in Mongo when its link is not from ML yet. */
  async function find(id: string): Promise<Product | null> {
    const known = (await catalog()).products.find((product) => product.id === id)
    if (known) {
      return known
    }
    const [source] = await (await mongoSource())([id])
    return source ? fromSource(source, undefined, 1) : null
  }

  registerConnectionHandlers(orca, deps.catalogSource)
  orca.panels.handle('catalog.view', async (query) => (await repository.database()).view(query))
  orca.panels.handle('catalog.history', async ({ id }) => (await repository.database()).history(id))
  orca.panels.handle('catalog.ids', async ({ scope }) => (await repository.database()).ids(scope))

  orca.panels.handle('catalog.sync', async (): Promise<ActionResult> => {
    try {
      const sources = await (await mongoSource())()
      const counts = sharedCounts(sources)
      const previous = new Map((await catalog()).products.map((product) => [product.id, product]))
      const products = sources.map((source) =>
        fromSource(source, previous.get(source.id), counts.get(source.productURL) ?? 1)
      )
      await repository.replace(products, Date.now())
      return { ok: true, message: `${products.length} suplementos cargados de la base.` }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  async function startAudit(ids?: readonly string[]): Promise<ActionResult> {
    if (auditRunning) {
      return { ok: false, message: 'Ya hay una lectura de precios en curso.' }
    }
    const products = (await catalog()).products.filter(
      (product) =>
        product.linkKind === 'referido' && (!ids || ids.length === 0 || ids.includes(product.id))
    )
    const urls = [...new Set(products.map((product) => product.productURL))]
    if (urls.length === 0) {
      return {
        ok: false,
        message: 'No hay links de referido que leer: sincroniza la base primero.'
      }
    }
    auditRunning = true
    let done = 0
    orca.panels.post('audit.progress', { running: true, done, total: urls.length, blocked: false })
    const client = await meli()
    // Long reads run past a request's 2-minute limit: answer now, report through posts.
    void client
      .readCards(urls, async (batch) => {
        await repository.recordReadings(batch)
        const byUrl = new Map(batch.map((reading) => [reading.url, reading]))
        await saveProducts((current) =>
          current.map((product) => {
            const card = byUrl.get(product.productURL)
            if (!card) {
              return product
            }
            const { url: _url, ...reading } = card
            return withStatus({ ...product, reading })
          })
        )
        done += batch.length
        orca.panels.post('audit.progress', {
          running: true,
          done,
          total: urls.length,
          blocked: false
        })
      })
      .then(
        () =>
          orca.panels.post('audit.progress', {
            running: false,
            done,
            total: urls.length,
            blocked: false
          }),
        (error: unknown) => {
          orca.log(`audit stopped: ${message(error)}`)
          orca.panels.post('audit.progress', {
            running: false,
            done,
            total: urls.length,
            blocked: true,
            reason: message(error)
          })
        }
      )
      .finally(() => {
        auditRunning = false
      })
    return { ok: true, message: `Leyendo ${urls.length} links en MercadoLibre…` }
  }

  orca.panels.handle('catalog.audit', ({ ids }) => startAudit(ids))

  registerReferralHandlers(orca, {
    catalog,
    find,
    saveProducts,
    recordAttempts: (attempts) => repository.recordAttempts(attempts),
    verify: (ids) => startAudit(ids),
    fetchImage: deps.fetchImage,
    refresh,
    meli,
    write: async (updates) => {
      await deps.patch(await backend(), updates)
    }
  })

  orca.panels.handle('catalog.applyPrices', async ({ ids }): Promise<ActionResult> => {
    const products = (await catalog()).products.filter((product) => ids.includes(product.id))
    const updates = products
      .map(pricePayload)
      .filter((update): update is SupplementUpdate => update !== null)
    if (updates.length === 0) {
      return { ok: false, message: 'Ninguno tiene un precio de MercadoLibre leído para aplicar.' }
    }
    try {
      await deps.patch(await backend(), updates)
      await refresh(updates.map((update) => update.id))
      return { ok: true, message: `${updates.length} precio(s) guardado(s) en la base.` }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  orca.panels.handle('catalog.applyUrl', async ({ id, url }): Promise<ActionResult> => {
    const productURL = url.trim()
    if (!isMeliUrl(productURL)) {
      return { ok: false, message: 'La URL debe ser de meli.la o mercadolibre.com.mx.' }
    }
    try {
      await deps.patch(await backend(), [{ id, productURL }])
      await refresh([id])
      if (!isReferralUrl(productURL)) {
        return { ok: true, message: 'URL guardada en la base.' }
      }
      const verifying = await startAudit([id])
      return {
        ok: true,
        message: verifying.ok
          ? 'URL guardada. Verificando en MercadoLibre: si queda «Al día» o «Cambio de precio», ya quedó.'
          : 'URL guardada. Usa «Leer precio» para confirmar que abre el producto.'
      }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  orca.panels.handle('catalog.setStock', async ({ id, hasStock }): Promise<ActionResult> => {
    try {
      await deps.patch(await backend(), [{ id, hasStock }])
      await refresh([id])
      return { ok: true, message: hasStock ? 'Marcado con stock.' : 'Marcado sin stock.' }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  wireSchedules(orca, {
    call,
    bus,
    databasePath: () => repository.path(),
    openStore: deps.openSchedules,
    products: async () => (await catalog()).products,
    queue,
    checkout: async () => {
      const minutes = Number(await orca.settings.get('captchaWaitMinutes'))
      return deps.checkout(
        await cliPath(),
        {
          waitMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000,
          onVerification: (body) => {
            void orca.host
              .call('notifications.show', { title: 'MercadoLibre pide captcha', body })
              .catch(() => undefined)
          }
        },
        await workspace()
      )
    }
  })
}

export default function activate(orca: OrcaWorkerApi): void {
  activateWith(orca, realDeps)
}
