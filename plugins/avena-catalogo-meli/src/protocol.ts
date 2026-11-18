// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.

export type LinkKind = 'referido' | 'directo'

export type ProductStatus =
  | 'sin_revisar'
  | 'ok'
  | 'precio_cambio'
  | 'sin_precio_base'
  | 'revisar_salto'
  | 'revisar_identidad'
  | 'link_compartido'
  | 'roto'
  | 'link_directo'
  | 'referido_rechazado'
  | 'referido_listo'

/** What the featured card of a meli.la link showed the last time it was read. */
export type MeliReading = {
  ok: boolean
  checkedAt: number
  price: number | null
  listPrice: number | null
  discountPercentage: number | null
  title: string | null
  seller: string | null
  mlItemId: string | null
  /** Photo URL on mlstatic.com; the panel never loads it, only the worker. */
  imageUrl?: string | null
  blocked?: boolean
}

export type SearchCandidate = {
  url: string
  title: string
  price: number | null
  seller: string | null
  /** The result's photo as a data: URL, fetched by the worker; null when none could be. */
  image: string | null
}

export type ReferralProposal = {
  url: string | null
  reason: string | null
  title: string | null
  createdAt: number
  /** Photo of the product the referral opens, as a data: URL. */
  image?: string | null
}

export type Product = {
  id: string
  name: string
  brand: string
  owner: string
  quantity: string | null
  flavor: string | null
  productURL: string
  linkKind: LinkKind
  sharedCount: number
  price: number | null
  listPrice: number | null
  discountPercentage: number | null
  mlItemId: string | null
  priceCheckedAt: string | null
  hasStock: boolean | null
  margin: number | null
  reading: MeliReading | null
  proposal: ReferralProposal | null
  status: ProductStatus
  diffPct: number | null
}

export type Catalog = {
  products: Product[]
  syncedAt: number | null
}

export type Filter = 'revisar' | 'todos' | 'con_referido' | ProductStatus

/** `applicable`: safe price changes. `allPrices`: every new ML price. `pendingReferrals`: referrals to save. */
export type BulkScope = 'applicable' | 'allPrices' | 'pendingReferrals'

export type CatalogViewQuery = {
  filter: Filter
  search: string
  sort: { column: string; direction: 'asc' | 'desc' }
  limit: number
}

/** One page of the table plus the counts the toolbar and legend show. */
export type CatalogView = {
  rows: Product[]
  total: number
  counts: Partial<Record<ProductStatus, number>>
  syncedAt: number | null
  all: number
  withReferral: number
  direct: number
  applicable: number
  pendingReferrals: number
  /** Referral links whose ML price differs from the saved one, any status. */
  withNewPrice: number
}

export type PriceHistoryEntry = {
  checkedAt: number
  ok: boolean
  price: number | null
  listPrice: number | null
  discountPercentage: number | null
  seller: string | null
}

export type ReferralAttempt = {
  targetUrl: string
  referral: string | null
  reason: string | null
  createdAt: number
}

export type ProductHistory = {
  product: Product
  readings: PriceHistoryEntry[]
  attempts: ReferralAttempt[]
}

export type CatalogConfig = {
  backendUrl: string
  backendPricesPath: string
  mongoDatabase: string
  mongoCollection: string
  catalogOwner: string
}

export type ConnectionStatus = {
  mongo: boolean
  backend: boolean
  config: CatalogConfig
}

export type AuditProgress = { running: boolean; done: number; total: number; blocked: boolean }

export type ReferralProgress = {
  running: boolean
  total: number
  generated: number
  error?: string
}

export type RepairProgress = {
  running: boolean
  total: number
  searched: number
  proposed: number
  error?: string
}

export type ActionResult = { ok: boolean; message: string }

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'connection.status': { output: ConnectionStatus }
    'connection.save': {
      input: {
        mongoUri?: string
        backendEmail?: string
        backendPassword?: string
        config?: Partial<CatalogConfig>
      }
      output: { status: ConnectionStatus; result: ActionResult }
    }
    /** Reloads the owner's MercadoLibre products from Mongo, keeping the last readings. */
    'catalog.sync': { output: ActionResult }
    'catalog.view': { input: CatalogViewQuery; output: CatalogView }
    /** The product with its last price readings and referral attempts. */
    'catalog.history': { input: { id: string }; output: ProductHistory | null }
    /** Ids of the products a bulk action applies to. */
    'catalog.ids': { input: { scope: BulkScope }; output: string[] }
    /** Reads ML for the given ids (every referral link when empty) in the background. */
    'catalog.audit': { input: { ids?: string[] }; output: ActionResult }
    /** Builds a meli.la for `url` (the product's own direct link when omitted) and keeps it as a proposal. */
    'catalog.generateReferral': { input: { id: string; url?: string }; output: ActionResult }
    /** Writes the ML price read for each id. */
    'catalog.applyPrices': { input: { ids: string[] }; output: ActionResult }
    /** Generates referrals for every product with a direct link, in the background. */
    'catalog.generateReferrals': { output: ActionResult }
    /** Saves each generated referral as the product's URL. */
    'catalog.applyProposals': { input: { ids: string[] }; output: ActionResult }
    /** MercadoLibre's search results for the product (or `query`), to pick a replacement link. */
    'catalog.searchReplacement': {
      input: { id: string; query?: string }
      output: ActionResult & { candidates: SearchCandidate[] }
    }
    /** For every broken link, proposes the first same-brand search result, in the background. */
    'catalog.proposeReplacements': { output: ActionResult }
    /** Generates the referral for `url`, then writes it and its price to the product. */
    'catalog.replaceLink': { input: { id: string; url: string }; output: ActionResult }
    'catalog.applyUrl': { input: { id: string; url: string }; output: ActionResult }
    'catalog.setStock': { input: { id: string; hasStock: boolean }; output: ActionResult }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'audit.progress': AuditProgress
    /** Posted after every write to the local database. */
    'catalog.changed': { at: number }
    'referrals.progress': ReferralProgress
    'repairs.progress': RepairProgress
  }
}
