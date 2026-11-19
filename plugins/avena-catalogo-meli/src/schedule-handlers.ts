// The panel's side of scheduled tasks and the mock purchase-order queue.
import type { OrcaWorkerApi } from 'orca/worker'
import type { FlowQueue } from './flow-queue'
import type { ActionResult } from './protocol'
import type { OrderSource } from './purchase-runner'
import { nextRunAt, parseTime } from './schedule-time'
import type { ScheduleStore } from './schedule-store'
import { TASK_LABELS } from './schedule-types'
import type { Scheduler } from './scheduler'

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** Orders kept in the plugin's database until the backend serves them (same contract). */
export function mockOrderSource(store: ScheduleStore): OrderSource {
  return {
    pending: async () => store.orders('pendiente'),
    report: async (orderId, status, results) =>
      store.updateOrder(orderId, status, results, Date.now())
  }
}

export function registerScheduleHandlers(
  orca: OrcaWorkerApi,
  store: () => Promise<ScheduleStore>,
  scheduler: () => Promise<Scheduler>,
  queue: FlowQueue
): void {
  const changed = () => orca.panels.post('schedules.changed', { at: Date.now() })

  orca.panels.handle('schedules.state', async () => {
    const db = await store()
    return { schedules: db.schedules(), runs: db.runs(), orders: db.orders(), queue: queue.state() }
  })

  orca.panels.handle('schedules.save', async (input): Promise<ActionResult> => {
    if (!parseTime(input.time)) {
      return { ok: false, message: 'La hora debe ser HH:MM, por ejemplo 09:30.' }
    }
    if (input.days.length === 0) {
      return { ok: false, message: 'Elige al menos un día.' }
    }
    const db = await store()
    const previous = db.schedules().find((schedule) => schedule.id === input.id)
    db.saveSchedule({
      id: input.id ?? id('tarea'),
      kind: input.kind,
      days: [...new Set(input.days)].sort(),
      time: input.time.trim(),
      everyHours: input.everyHours ?? null,
      enabled: input.enabled,
      mode: input.kind === 'processOrders' ? input.mode : 'prueba',
      nextRunAt: input.enabled
        ? nextRunAt(input.days, input.time, Date.now(), input.everyHours)
        : null,
      lastRunAt: previous?.lastRunAt ?? null
    })
    changed()
    return { ok: true, message: `«${TASK_LABELS[input.kind]}» programada.` }
  })

  orca.panels.handle('schedules.remove', async ({ id: scheduleId }): Promise<ActionResult> => {
    ;(await store()).removeSchedule(scheduleId)
    changed()
    return { ok: true, message: 'Tarea eliminada.' }
  })

  orca.panels.handle('schedules.runNow', async ({ kind, mode }): Promise<ActionResult> => {
    void (await scheduler()).runNow(kind, mode, null)
    return {
      ok: true,
      message: `«${TASK_LABELS[kind]}» corriendo; el resultado queda en el historial.`
    }
  })

  orca.panels.handle(
    'orders.createMock',
    async ({ address, items, cap }): Promise<ActionResult> => {
      const missing = (
        [
          'recipient',
          'phone',
          'street',
          'number',
          'colonia',
          'postalCode',
          'municipality',
          'state'
        ] as const
      ).filter((key) => !address[key]?.trim())
      if (missing.length > 0 || items.length === 0 || !(cap > 0)) {
        return {
          ok: false,
          message: 'Faltan datos: domicilio completo, al menos un producto y un tope.'
        }
      }
      const at = Date.now()
      ;(await store()).saveOrder({
        id: id('pedido'),
        createdAt: at,
        updatedAt: at,
        status: 'pendiente',
        address,
        items: items.filter((item) => item.quantity > 0),
        cap,
        results: []
      })
      changed()
      return { ok: true, message: 'Pedido de prueba en la cola.' }
    }
  )

  orca.panels.handle('orders.retry', async ({ id: orderId }): Promise<ActionResult> => {
    ;(await store()).updateOrder(orderId, 'pendiente', [], Date.now())
    changed()
    return { ok: true, message: 'El pedido vuelve a estar pendiente.' }
  })
}
