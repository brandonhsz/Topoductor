// Puts scheduled tasks together: the store next to the catalog database, the task runner over the
// panel's own handlers, the purchase runner over the mock queue, and the minute-by-minute scheduler.
import type { OrcaWorkerApi } from 'orca/worker'
import type { CheckoutClient } from './checkout-browser'
import type { FlowQueue } from './flow-queue'
import type { LocalBus, LocalCall } from './local-panels'
import type { Product } from './protocol'
import { processOrders } from './purchase-runner'
import { mockOrderSource, registerScheduleHandlers } from './schedule-handlers'
import type { ScheduleStore } from './schedule-store'
import { startScheduler, type Scheduler } from './scheduler'
import { createTaskRunner } from './task-runner'

export function wireSchedules(
  orca: OrcaWorkerApi,
  options: {
    call: LocalCall
    bus: LocalBus
    databasePath(): Promise<string>
    openStore(path: string): ScheduleStore
    products(): Promise<Product[]>
    checkout(): Promise<CheckoutClient>
    queue: FlowQueue
  }
): void {
  let opened: Promise<ScheduleStore> | null = null
  const store = () => (opened ??= options.databasePath().then(options.openStore))
  const run = createTaskRunner({
    call: options.call,
    bus: options.bus,
    // A whole run of orders is one turn of the queue: nothing else uses the tab in between.
    processOrders: (mode) =>
      options.queue.run('Procesar pedidos de compra', async () =>
        processOrders({
          source: mockOrderSource(await store()),
          products: new Map((await options.products()).map((product) => [product.id, product])),
          checkout: await options.checkout(),
          mode
        })
      )
  })
  let started: Promise<Scheduler> | null = null
  const scheduler = () =>
    (started ??= store().then((db) =>
      startScheduler({
        store: db,
        run,
        changed: () => orca.panels.post('schedules.changed', { at: Date.now() }),
        notify: (title, body) => {
          void orca.host.call('notifications.show', { title, body }).catch(() => undefined)
        }
      })
    ))
  registerScheduleHandlers(orca, store, scheduler, options.queue)
  // Due tasks start ticking as soon as the worker is up, panel open or not.
  void scheduler().catch((error: unknown) => orca.log(`scheduler: ${String(error)}`))
}
