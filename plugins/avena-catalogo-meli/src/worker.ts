// The plugin's worker: keeps the catalog in orca.storage (shared with the panel), reads ML through
// Topo's browser, and writes through the configured backend.
import type { OrcaWorkerApi } from 'orca/worker'
import { patchSupplements, type BackendCredentials, type SupplementUpdate } from './backend-client'
import {
  mongoCatalogSource,
  normalizeMongoUri,
  type CatalogSource,
  type MongoLocation,
  type SourceProduct
} from './catalog-source'
import { backendCredentials, mongoLocation, readCatalogConfig } from './catalog-config'
import { isReferralUrl, pricePayload, withStatus } from './catalog-status'
import { isCatalog } from './json-fields'
import { cliRunner, MeliBrowser, type MeliClient } from './meli-browser'
import { proposeReferral } from './referral-proposal'
import type { ActionResult, Catalog, CatalogConfig, ConnectionStatus, Product } from './protocol'

export type WorkerDeps = {
  catalogSource(uri: string, location: MongoLocation): CatalogSource
  meli(cliPath: string): MeliClient
  patch(credentials: BackendCredentials, updates: readonly SupplementUpdate[]): Promise<unknown>
}

const CATALOG = 'catalog'
const DEFAULT_CLI = '/Applications/Topo.app/Contents/Resources/bin/topo'
const ML_URL = /^https:\/\/(meli\.la|(www\.|articulo\.)?mercadolibre\.com\.mx)\//i

const realDeps: WorkerDeps = {
  catalogSource: mongoCatalogSource,
  meli: (cliPath) => new MeliBrowser(cliRunner(cliPath)),
  patch: patchSupplements
}

type StoredJson = Parameters<OrcaWorkerApi['storage']['set']>[1]

/** The catalog is plain JSON already; the round trip types it as storage's JsonValue. */
function storedJson(catalog: Catalog): StoredJson {
  const json: StoredJson = JSON.parse(JSON.stringify(catalog))
  return json
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fromSource(
  source: SourceProduct,
  previous: Product | undefined,
  sharedCount: number
): Product {
  const sameLink = previous?.productURL === source.productURL
  return withStatus({
    ...source,
    sharedCount,
    reading: sameLink ? previous.reading : null,
    proposal: sameLink ? previous.proposal : null,
    status: 'sin_revisar',
    diffPct: null
  })
}

function sharedCounts(
  products: readonly { productURL: string; linkKind: string }[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const product of products) {
    if (product.linkKind === 'referido') {
      counts.set(product.productURL, (counts.get(product.productURL) ?? 0) + 1)
    }
  }
  return counts
}

export function activateWith(orca: OrcaWorkerApi, deps: WorkerDeps): void {
  let auditRunning = false

  async function catalog(): Promise<Catalog> {
    const stored = await orca.storage.get(CATALOG)
    return isCatalog(stored) ? stored : { products: [], syncedAt: null }
  }

  async function saveProducts(
    change: (products: Product[]) => Product[],
    syncedAt?: number
  ): Promise<void> {
    const current = await catalog()
    const next: Catalog = {
      products: change(current.products),
      syncedAt: syncedAt ?? current.syncedAt
    }
    await orca.storage.set(CATALOG, storedJson(next))
  }

  async function mongoSource(): Promise<CatalogSource> {
    const uri = await orca.secrets.get('mongoUri')
    if (!uri) {
      throw new Error('Falta la conexión a Mongo: agrégala en Conexiones.')
    }
    return deps.catalogSource(uri, mongoLocation(await config()))
  }

  const backend = (): Promise<BackendCredentials> => backendCredentials(orca)
  const config = (): Promise<CatalogConfig> => readCatalogConfig(orca)

  async function meli(): Promise<MeliClient> {
    const configured = await orca.settings.get('topoCli')
    return deps.meli(String(configured || process.env.TOPO_CLI_COMMAND || DEFAULT_CLI))
  }

  /** Re-reads `ids` from Mongo after a write, so the panel shows what the database holds. */
  async function refresh(ids: readonly string[]): Promise<void> {
    const fresh = new Map(
      (await (await mongoSource())(ids)).map((product) => [product.id, product])
    )
    await saveProducts((products) => {
      const counts = sharedCounts(products.map((product) => fresh.get(product.id) ?? product))
      return products.map((product) => {
        const source = fresh.get(product.id) ?? product
        return fromSource(source, product, counts.get(source.productURL) ?? 1)
      })
    })
  }

  async function status(): Promise<ConnectionStatus> {
    const [mongoUri, email, password, current] = await Promise.all([
      orca.secrets.get('mongoUri'),
      orca.secrets.get('backendEmail'),
      orca.secrets.get('backendPassword'),
      config()
    ])
    return {
      mongo: Boolean(
        mongoUri && current.mongoDatabase && current.mongoCollection && current.catalogOwner
      ),
      backend: Boolean(email && password && current.backendUrl && current.backendPricesPath),
      config: current
    }
  }

  orca.panels.handle('connection.status', status)

  orca.panels.handle('connection.save', async (input) => {
    for (const [key, value] of Object.entries(input.config ?? {})) {
      if (typeof value === 'string') {
        await orca.settings.set(key, value.trim())
      }
    }
    const mongoUri = input.mongoUri?.trim() ? normalizeMongoUri(input.mongoUri) : null
    if (mongoUri) {
      // Test before storing so a bad URI never replaces one that works.
      try {
        await deps.catalogSource(mongoUri, mongoLocation(await config()))([])
      } catch (error) {
        return {
          status: await status(),
          result: { ok: false, message: `No se pudo conectar a Mongo: ${message(error)}` }
        }
      }
      await orca.secrets.set('mongoUri', mongoUri)
    }
    const entries: [string, string | undefined][] = [
      ['backendEmail', input.backendEmail],
      ['backendPassword', input.backendPassword]
    ]
    for (const [key, value] of entries) {
      if (value?.trim()) {
        await orca.secrets.set(key, value.trim())
      }
    }
    return {
      status: await status(),
      result: { ok: true, message: 'Conexiones guardadas en los secretos del plugin.' }
    }
  })

  orca.panels.handle('catalog.sync', async (): Promise<ActionResult> => {
    try {
      const sources = await (await mongoSource())()
      const counts = sharedCounts(sources)
      const previous = new Map((await catalog()).products.map((product) => [product.id, product]))
      const products = sources.map((source) =>
        fromSource(source, previous.get(source.id), counts.get(source.productURL) ?? 1)
      )
      await orca.storage.set(CATALOG, storedJson({ products, syncedAt: Date.now() }))
      return { ok: true, message: `${products.length} suplementos cargados de la base.` }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  orca.panels.handle('catalog.audit', async ({ ids }): Promise<ActionResult> => {
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
            blocked: true
          })
        }
      )
      .finally(() => {
        auditRunning = false
      })
    return { ok: true, message: `Leyendo ${urls.length} links en MercadoLibre…` }
  })

  orca.panels.handle('catalog.generateReferral', async ({ id, url }): Promise<ActionResult> => {
    const product = (await catalog()).products.find((candidate) => candidate.id === id)
    if (!product) {
      return { ok: false, message: 'El producto ya no está en el catálogo.' }
    }
    const target = (url ?? (product.linkKind === 'directo' ? product.productURL : '')).trim()
    if (!ML_URL.test(target) || isReferralUrl(target)) {
      return {
        ok: false,
        message: 'Pega la URL del producto en mercadolibre.com.mx para generar su referido.'
      }
    }
    try {
      const proposal = await proposeReferral(await meli(), target)
      await saveProducts((products) =>
        products.map((candidate) => (candidate.id === id ? { ...candidate, proposal } : candidate))
      )
      return proposal.url
        ? { ok: true, message: `Referido listo: ${proposal.url}` }
        : { ok: false, message: proposal.reason ?? 'MercadoLibre no generó el referido' }
    } catch (error) {
      return { ok: false, message: message(error) }
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
    if (!ML_URL.test(productURL)) {
      return { ok: false, message: 'La URL debe ser de meli.la o mercadolibre.com.mx.' }
    }
    try {
      await deps.patch(await backend(), [{ id, productURL }])
      await refresh([id])
      return { ok: true, message: 'URL guardada en la base.' }
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
}

export default function activate(orca: OrcaWorkerApi): void {
  activateWith(orca, realDeps)
}
