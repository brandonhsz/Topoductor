// The panel holds only what it shows: one page of the table and the selected product's history.
// The worker owns the data (SQLite) and answers every query.
import { atom, derived, plugin, read, set, type TableSort } from 'orca'
import type {
  ActionResult,
  AuditProgress,
  CatalogView,
  ConnectionStatus,
  Filter,
  ProductHistory,
  ProductStatus,
  ReferralProgress,
  RepairProgress
} from './protocol'

export type { Filter } from './protocol'

/** Statuses a person has to look at; the default view. */
export const REVIEW_STATUSES: readonly ProductStatus[] = [
  'precio_cambio',
  'sin_precio_base',
  'revisar_salto',
  'revisar_identidad',
  'link_compartido',
  'roto',
  'link_directo',
  'referido_rechazado',
  'referido_listo'
]

const PAGE = 200

export const view = atom<CatalogView | null>(null)
export const filter = atom<Filter>('filter', 'revisar', { persist: 'plugin' })
export const search = atom('')
export const sort = atom<TableSort>({ column: 'producto', direction: 'asc' })
export const limit = atom(PAGE)
export const selectedId = atom<string | null>(null)
export const history = atom<ProductHistory | null>(null)
export const urlDraft = atom('')
export const notice = atom<{ ok: boolean; text: string } | null>(null)
export const busy = atom<string | null>(null)
export const progress = atom<AuditProgress | null>(null)
export const connection = atom<ConnectionStatus | null>(null)
export const referralProgress = atom<ReferralProgress | null>(null)
export const confirmingReferrals = atom(false)
export const repairProgress = atom<RepairProgress | null>(null)

// Only the history of the row selected now: an answer for an earlier click is never shown.
export const selected = derived(() => {
  const current = read(history)
  return current && current.product.id === read(selectedId) ? current.product : null
})

// Answers can arrive out of order; each load keeps only the newest one it asked for.
let viewRequest = 0

export async function loadView(): Promise<void> {
  const asked = ++viewRequest
  const answer = await plugin.request('catalog.view', {
    filter: read(filter),
    search: read(search),
    sort: read(sort),
    limit: read(limit)
  })
  if (asked === viewRequest) {
    set(view, answer)
  }
}

export async function loadHistory(): Promise<void> {
  const id = read(selectedId)
  const answer = id ? await plugin.request('catalog.history', { id }) : null
  if (read(selectedId) === id) {
    set(history, answer)
  }
}

/** Re-reads what is on screen after the worker writes. */
export async function refreshAll(): Promise<void> {
  await Promise.all([loadView(), loadHistory()])
}

export function changeFilter(next: Filter): void {
  set(filter, next)
  set(limit, PAGE)
  void loadView()
}

export function changeSearch(next: string): void {
  set(search, next)
  set(limit, PAGE)
  void loadView()
}

export function changeSort(next: TableSort): void {
  set(sort, next)
  void loadView()
}

export function loadMore(): void {
  set(limit, read(limit) + PAGE)
  void loadView()
}

export function selectProduct(id: string | null): void {
  set(selectedId, id)
  set(urlDraft, '')
  void loadHistory()
}

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
