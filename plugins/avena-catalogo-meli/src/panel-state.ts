import { atom, derived, plugin, read, set, type TableSort } from 'orca'
import { APPLICABLE_STATUSES } from './catalog-status'
import type {
  ActionResult,
  AuditProgress,
  Catalog,
  ConnectionStatus,
  Product,
  ProductStatus
} from './protocol'

export type Filter = 'revisar' | 'todos' | 'con_referido' | ProductStatus

/** Statuses a person has to look at; the default view. */
export const REVIEW_STATUSES: readonly ProductStatus[] = [
  'precio_cambio',
  'sin_precio_base',
  'revisar_salto',
  'revisar_identidad',
  'link_compartido',
  'roto',
  'link_directo'
]

// Kept by the worker in the plugin's storage; this atom follows its writes.
export const catalog = atom<Catalog | null>('catalog', null, { persist: 'storage' })
export const filter = atom<Filter>('filter', 'revisar', { persist: 'plugin' })
export const search = atom('')
export const sort = atom<TableSort>({ column: 'producto', direction: 'asc' })
export const selectedId = atom<string | null>(null)
export const urlDraft = atom('')
export const notice = atom<{ ok: boolean; text: string } | null>(null)
export const busy = atom<string | null>(null)
export const progress = atom<AuditProgress | null>(null)
export const connection = atom<ConnectionStatus | null>(null)
export const confirmingBulk = atom(false)

export const products = derived(() => read(catalog)?.products ?? [])

export const selected = derived(() => {
  const id = read(selectedId)
  return read(products).find((product) => product.id === id) ?? null
})

export const applicable = derived(() =>
  read(products).filter((product) => APPLICABLE_STATUSES.includes(product.status))
)

function matches(product: Product, active: Filter, query: string): boolean {
  const inFilter =
    active === 'todos' ||
    (active === 'con_referido' && product.linkKind === 'referido') ||
    (active === 'revisar' && REVIEW_STATUSES.includes(product.status)) ||
    product.status === active
  if (!inFilter) {
    return false
  }
  return !query || `${product.brand} ${product.name}`.toLowerCase().includes(query)
}

function sortValue(product: Product, column: string): string | number {
  switch (column) {
    case 'guardado':
      return product.price ?? -1
    case 'ml':
      return product.reading?.price ?? -1
    case 'dif':
      return product.diffPct ?? 0
    case 'estatus':
      return product.status
    default:
      return `${product.brand} ${product.name}`.toLowerCase()
  }
}

export const visible = derived(() => {
  const active = read(filter)
  const query = read(search).trim().toLowerCase()
  const { column, direction } = read(sort)
  const factor = direction === 'asc' ? 1 : -1
  return read(products)
    .filter((product) => matches(product, active, query))
    .sort((a, b) => {
      const left = sortValue(a, column)
      const right = sortValue(b, column)
      return (left < right ? -1 : left > right ? 1 : 0) * factor
    })
})

export async function runAction(label: string, action: () => Promise<ActionResult>): Promise<void> {
  set(busy, label)
  try {
    const result = await action()
    set(notice, { ok: result.ok, text: result.message })
  } catch (error) {
    set(notice, { ok: false, text: error instanceof Error ? error.message : String(error) })
  } finally {
    set(busy, null)
  }
}

export async function loadConnection(): Promise<void> {
  set(connection, await plugin.request('connection.status'))
}
