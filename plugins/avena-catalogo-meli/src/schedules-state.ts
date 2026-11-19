// Panel state for scheduled tasks and the mock purchase-order queue.
import { atom, plugin, set } from 'orca'
import type { Product, SchedulesState } from './protocol'
import type { OrderAddress, OrderItem, PurchaseMode, TaskKind } from './schedule-types'

export const schedulesState = atom<SchedulesState | null>(null)

export type ScheduleDraft = {
  kind: TaskKind
  days: number[]
  time: string
  mode: PurchaseMode
}

export const scheduleDraft = atom<ScheduleDraft>({
  kind: 'audit',
  days: [1, 2, 3, 4, 5],
  time: '09:00',
  mode: 'prueba'
})

export const EMPTY_ADDRESS: OrderAddress = {
  recipient: '',
  phone: '',
  street: '',
  number: '',
  interior: null,
  colonia: '',
  postalCode: '',
  municipality: '',
  state: '',
  references: null
}

export type OrderDraft = { address: OrderAddress; items: OrderItem[]; cap: string }

export const orderDraft = atom<OrderDraft>({ address: EMPTY_ADDRESS, items: [], cap: '' })
export const productSearch = atom('')
export const productMatches = atom<Product[]>([])
/** Names of the products picked for the draft, so the list reads without another request. */
export const pickedNames = atom<Record<string, string>>({})

export async function loadSchedules(): Promise<void> {
  set(schedulesState, await plugin.request('schedules.state'))
}

export async function searchProducts(query: string): Promise<void> {
  set(productSearch, query)
  if (query.trim().length < 2) {
    set(productMatches, [])
    return
  }
  const found = await plugin.request('catalog.view', {
    filter: 'con_referido',
    search: query,
    sort: { column: 'producto', direction: 'asc' },
    limit: 8
  })
  set(productMatches, found.rows)
}

/** Parses the cap typed in the form; `null` when it is not a positive amount. */
export function parseCap(cap: string): number | null {
  const value = Number(cap.replace(/[$,\s]/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}
