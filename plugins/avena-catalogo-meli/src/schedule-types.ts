// Scheduled tasks and purchase orders, shared by the panel and the worker.

export type TaskKind =
  | 'sync'
  | 'audit'
  | 'applyPrices'
  | 'generateReferrals'
  | 'proposeReplacements'
  | 'processOrders'

export const TASK_LABELS: Record<TaskKind, string> = {
  sync: 'Sincronizar base',
  audit: 'Leer precios en ML',
  applyPrices: 'Aplicar cambios de precio',
  generateReferrals: 'Generar referidos',
  proposeReplacements: 'Buscar reemplazos de links rotos',
  processOrders: 'Procesar pedidos de compra'
}

/** `prueba` stops at the order review; `real` confirms when the total is within the cap. */
export type PurchaseMode = 'prueba' | 'real'

export type Schedule = {
  id: string
  kind: TaskKind
  days: number[]
  time: string
  enabled: boolean
  mode: PurchaseMode
  nextRunAt: number | null
  lastRunAt: number | null
}

export type ScheduleRun = {
  id: number
  scheduleId: string | null
  kind: TaskKind
  startedAt: number
  finishedAt: number | null
  ok: boolean
  summary: string
}

export type OrderAddress = {
  recipient: string
  phone: string
  street: string
  number: string
  interior: string | null
  colonia: string
  postalCode: string
  municipality: string
  state: string
  references: string | null
}

export type OrderItem = { productId: string; quantity: number }

export type OrderStatus = 'pendiente' | 'en_proceso' | 'comprado' | 'en_revision' | 'detenido'

export type OrderItemResult = {
  productId: string
  stage: string
  total: number | null
  orderNumber: string | null
  message: string
}

export type PurchaseOrder = {
  id: string
  createdAt: number
  status: OrderStatus
  address: OrderAddress
  items: OrderItem[]
  /** Most the whole order may cost, MXN. */
  cap: number
  results: OrderItemResult[]
  updatedAt: number
}
