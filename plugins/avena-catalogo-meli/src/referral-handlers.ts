// Referral links: one product from its detail, or every product without one in the background.
import type { OrcaWorkerApi } from 'orca/worker'
import type { SupplementUpdate } from './backend-client'
import { brandMatches, isMeliUrl, isReferralUrl, withStatus } from './catalog-status'
import type { ImageFetcher } from './image-data'
import type { MeliClient } from './meli-browser'
import type { ActionResult, Catalog, Product, ReferralProposal } from './protocol'
import { proposeReferrals } from './referral-proposal'

export type CatalogContext = {
  catalog(): Promise<Catalog>
  saveProducts(change: (products: Product[]) => Product[]): Promise<void>
  recordAttempts(attempts: readonly [string, string, ReferralProposal][]): Promise<void>
  fetchImage: ImageFetcher
  /** Reads the saved links in MercadoLibre again, to confirm each opens its product. */
  verify(ids: readonly string[]): Promise<ActionResult>
  refresh(ids: readonly string[]): Promise<void>
  meli(): Promise<MeliClient>
  write(updates: readonly SupplementUpdate[]): Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerReferralHandlers(orca: OrcaWorkerApi, context: CatalogContext): void {
  let bulkRunning = false

  /** Stores each product's proposal; nothing reaches the database until it is saved. */
  async function propose(targets: Map<string, string>): Promise<number> {
    const proposals = await proposeReferrals(await context.meli(), [...new Set(targets.values())])
    // The card's photo URL becomes bytes here: the panel cannot load it from the network.
    for (const [target, proposal] of proposals) {
      proposals.set(target, {
        ...proposal,
        image: proposal.image ? await context.fetchImage(proposal.image, 'preview') : null
      })
    }
    await context.recordAttempts(
      [...targets].flatMap(([id, target]): [string, string, ReferralProposal][] => {
        const proposal = proposals.get(target)
        return proposal ? [[id, target, proposal]] : []
      })
    )
    await context.saveProducts((products) =>
      products.map((product) => {
        const target = targets.get(product.id)
        const proposal = target ? proposals.get(target) : undefined
        return proposal ? withStatus({ ...product, proposal }) : product
      })
    )
    return [...targets.values()].filter((target) => proposals.get(target)?.url).length
  }

  orca.panels.handle('catalog.generateReferral', async ({ id, url }): Promise<ActionResult> => {
    const product = (await context.catalog()).products.find((candidate) => candidate.id === id)
    if (!product) {
      return { ok: false, message: 'El producto ya no está en el catálogo.' }
    }
    const target = (url ?? (product.linkKind === 'directo' ? product.productURL : '')).trim()
    if (!isMeliUrl(target) || isReferralUrl(target)) {
      return {
        ok: false,
        message: 'Pega la URL del producto en mercadolibre.com.mx para generar su referido.'
      }
    }
    try {
      await propose(new Map([[id, target]]))
      const proposal = (await context.catalog()).products.find((p) => p.id === id)?.proposal
      return proposal?.url
        ? { ok: true, message: `Referido listo: ${proposal.url}` }
        : { ok: false, message: proposal?.reason ?? 'MercadoLibre no generó el referido' }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  orca.panels.handle('catalog.generateReferrals', async (): Promise<ActionResult> => {
    if (bulkRunning) {
      return { ok: false, message: 'Ya se están generando referidos.' }
    }
    const targets = new Map(
      (await context.catalog()).products
        .filter((product) => product.linkKind === 'directo')
        .map((product): [string, string] => [product.id, product.productURL])
    )
    if (targets.size === 0) {
      return { ok: false, message: 'Todos los productos ya tienen link de referido.' }
    }
    bulkRunning = true
    orca.panels.post('referrals.progress', { running: true, total: targets.size, generated: 0 })
    // MercadoLibre answers in batches of 11; answer now and report through a post.
    void propose(targets)
      .then(
        (generated) =>
          orca.panels.post('referrals.progress', {
            running: false,
            total: targets.size,
            generated
          }),
        (error: unknown) => {
          orca.log(`referrals stopped: ${message(error)}`)
          orca.panels.post('referrals.progress', {
            running: false,
            total: targets.size,
            generated: 0,
            error: message(error)
          })
        }
      )
      .finally(() => {
        bulkRunning = false
      })
    return { ok: true, message: `Generando referidos para ${targets.size} productos…` }
  })

  orca.panels.handle('catalog.applyProposals', async ({ ids }): Promise<ActionResult> => {
    const updates = (await context.catalog()).products.flatMap((product) =>
      ids.includes(product.id) && product.proposal?.url
        ? [{ id: product.id, productURL: product.proposal.url }]
        : []
    )
    if (updates.length === 0) {
      return { ok: false, message: 'No hay referidos generados para guardar.' }
    }
    try {
      await context.write(updates)
      await context.refresh(updates.map((update) => update.id))
      const verifying = await context.verify(updates.map((update) => update.id))
      return {
        ok: true,
        message: verifying.ok
          ? `${updates.length} referido(s) guardado(s). Verificando en MercadoLibre que abran su producto: los que queden «Al día» o «Cambio de precio» ya quedaron.`
          : `${updates.length} referido(s) guardado(s). Usa «Leer precios en ML» para confirmar que abren su producto.`
      }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  orca.panels.handle('catalog.searchReplacement', async ({ id, query }) => {
    const product = (await context.catalog()).products.find((candidate) => candidate.id === id)
    if (!product) {
      return { ok: false, message: 'El producto ya no está en el catálogo.', candidates: [] }
    }
    try {
      const results = await (
        await context.meli()
      ).search(query?.trim() || `${product.brand} ${product.name}`)
      const candidates = await Promise.all(
        results.map(async ({ imageUrl, ...result }) => ({
          ...result,
          image: imageUrl ? await context.fetchImage(imageUrl, 'thumb') : null
        }))
      )
      return {
        ok: candidates.length > 0,
        message:
          candidates.length > 0
            ? `${candidates.length} resultados: elige el producto correcto para generar su referido.`
            : 'MercadoLibre no encontró resultados: prueba con otras palabras.',
        candidates
      }
    } catch (error) {
      return { ok: false, message: message(error), candidates: [] }
    }
  })

  orca.panels.handle('catalog.proposeReplacements', async (): Promise<ActionResult> => {
    if (bulkRunning) {
      return { ok: false, message: 'Ya hay una búsqueda o generación de referidos en curso.' }
    }
    const broken = (await context.catalog()).products.filter((p) => p.status === 'roto')
    if (broken.length === 0) {
      return { ok: false, message: 'No hay links rotos.' }
    }
    bulkRunning = true
    const total = broken.length
    orca.panels.post('repairs.progress', { running: true, total, proposed: 0, searched: 0 })
    // Searching is one page per product; answer now and report through posts.
    void (async () => {
      const client = await context.meli()
      const targets = new Map<string, string>()
      let searched = 0
      for (const product of broken) {
        const results = await client.search(`${product.brand} ${product.name}`)
        // Only a result naming the same brand is proposed; a person reviews it before saving.
        const match = results.find((result) => brandMatches(product.brand, result.title))
        if (match) {
          targets.set(product.id, match.url)
        }
        searched += 1
        orca.panels.post('repairs.progress', { running: true, total, proposed: 0, searched })
      }
      return targets.size > 0 ? propose(targets) : 0
    })()
      .then(
        (proposed) =>
          orca.panels.post('repairs.progress', {
            running: false,
            total,
            proposed,
            searched: total
          }),
        (error: unknown) => {
          orca.log(`repairs stopped: ${message(error)}`)
          orca.panels.post('repairs.progress', {
            running: false,
            total,
            proposed: 0,
            searched: 0,
            error: message(error)
          })
        }
      )
      .finally(() => {
        bulkRunning = false
      })
    return { ok: true, message: `Buscando reemplazo para ${total} links rotos…` }
  })
}
