// What each scheduled task does, through the same handlers as the panel's buttons.
import { field } from './json-fields'
import type { LocalBus, LocalCall } from './local-panels'
import type { RunSummary } from './purchase-runner'
import type { PurchaseMode, TaskKind } from './schedule-types'

export type TaskOutcome = { ok: boolean; summary: string }

const LONG = 60 * 60_000
const finished = (payload: unknown) => field(payload, 'running') === false

const stopReason = (end: unknown): string => {
  const reason = field(end, 'reason')
  return typeof reason === 'string' && reason ? reason : 'MercadoLibre pidió verificación'
}

function result(answer: unknown): TaskOutcome {
  return { ok: field(answer, 'ok') === true, summary: String(field(answer, 'message') ?? '') }
}

export function createTaskRunner(options: {
  call: LocalCall
  bus: LocalBus
  processOrders(mode: PurchaseMode): Promise<RunSummary>
}): (kind: TaskKind, mode: PurchaseMode) => Promise<TaskOutcome> {
  const { call, bus } = options
  // Start the job and wait for its "finished" post, so the run records the real outcome.
  const background = async (name: string, input: unknown, event: string): Promise<unknown> => {
    const done = bus.next(event, finished, LONG)
    const started = result(await call(name, input))
    if (!started.ok) {
      done.catch(() => undefined)
      return { failed: started.summary }
    }
    return done
  }
  return async (kind, mode) => {
    switch (kind) {
      case 'sync':
        return result(await call('catalog.sync'))
      case 'audit': {
        const end = await background('catalog.audit', {}, 'audit.progress')
        const failed = field(end, 'failed')
        if (typeof failed === 'string') {
          return { ok: false, summary: failed }
        }
        return {
          ok: field(end, 'blocked') !== true,
          summary: `${String(field(end, 'done'))}/${String(field(end, 'total'))} links leídos${field(end, 'blocked') === true ? `; ${stopReason(end)}` : ''}`
        }
      }
      case 'updatePrices': {
        const read = await background('catalog.audit', {}, 'audit.progress')
        const failed = field(read, 'failed')
        if (typeof failed === 'string') {
          return { ok: false, summary: failed }
        }
        const readSummary = `${String(field(read, 'done'))}/${String(field(read, 'total'))} links leídos`
        if (field(read, 'blocked') === true) {
          return {
            ok: false,
            summary: `${readSummary}; ${stopReason(read)}. No se aplicó nada`
          }
        }
        const ids = await call('catalog.ids', { scope: 'priceUpdates' })
        const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
        if (list.length === 0) {
          return { ok: true, summary: `${readSummary} · sin cambios de precio` }
        }
        const applied = result(await call('catalog.applyPrices', { ids: list }))
        return { ok: applied.ok, summary: `${readSummary} · ${applied.summary}` }
      }
      case 'applyPrices': {
        const ids = await call('catalog.ids', { scope: 'applicable' })
        const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
        return list.length === 0
          ? { ok: true, summary: 'No había cambios de precio por aplicar' }
          : result(await call('catalog.applyPrices', { ids: list }))
      }
      case 'generateReferrals':
      case 'proposeReplacements': {
        const [name, event] =
          kind === 'generateReferrals'
            ? ['catalog.generateReferrals', 'referrals.progress']
            : ['catalog.proposeReplacements', 'repairs.progress']
        const end = await background(name, undefined, event)
        const failed = field(end, 'failed') ?? field(end, 'error')
        if (typeof failed === 'string') {
          return { ok: false, summary: failed }
        }
        const made = field(end, 'generated') ?? field(end, 'proposed')
        return {
          ok: true,
          summary: `${String(made)} de ${String(field(end, 'total'))} listos para revisar`
        }
      }
      case 'processOrders': {
        const run = await options.processOrders(mode)
        return {
          ok: run.stopped === 0,
          summary:
            run.processed === 0
              ? 'No había pedidos pendientes'
              : `${run.processed} pedidos: ${run.bought} comprados, ${run.review} listos (prueba), ${run.stopped} detenidos`
        }
      }
    }
  }
}
