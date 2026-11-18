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
  blocked?: boolean
}

export type ReferralProposal = {
  url: string | null
  reason: string | null
  title: string | null
  createdAt: number
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
    /** Reads ML for the given ids (every referral link when empty) in the background. */
    'catalog.audit': { input: { ids?: string[] }; output: ActionResult }
    /** Builds a meli.la for `url` (the product's own direct link when omitted) and keeps it as a proposal. */
    'catalog.generateReferral': { input: { id: string; url?: string }; output: ActionResult }
    /** Writes the ML price read for each id. */
    'catalog.applyPrices': { input: { ids: string[] }; output: ActionResult }
    'catalog.applyUrl': { input: { id: string; url: string }; output: ActionResult }
    'catalog.setStock': { input: { id: string; hasStock: boolean }; output: ActionResult }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'audit.progress': AuditProgress
  }
}
