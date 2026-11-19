// Lets a scheduled task use the same handlers and progress events the panel uses: every handler
// the worker registers is also callable in-process, and every post is heard locally too.
import type { OrcaWorkerApi, PanelRequestContext, PanelsApi } from 'orca/worker'

type Handler = (input: unknown, context: PanelRequestContext) => unknown
export type LocalCall = (name: string, input?: unknown) => Promise<unknown>
export type LocalBus = {
  /** Resolves with the first payload of `event` that `matches`, or rejects after `timeoutMs`. */
  next(event: string, matches: (payload: unknown) => boolean, timeoutMs: number): Promise<unknown>
}

const SCHEDULER_CONTEXT = (): PanelRequestContext => ({
  panel: { id: 'scheduler', surface: 'panel', contributionId: 'catalogo' },
  signal: new AbortController().signal
})

export function withLocalPanels(orca: OrcaWorkerApi): {
  orca: OrcaWorkerApi
  call: LocalCall
  bus: LocalBus
} {
  const handlers = new Map<string, Handler>()
  const listeners = new Set<(event: string, payload: unknown) => void>()
  const panels: PanelsApi = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwards the same arguments to Topo's typed handle; only remembers the handler by name.
    handle: ((name: string, handler: Handler) => {
      handlers.set(name, handler)
      return Reflect.apply(orca.panels.handle, orca.panels, [name, handler])
    }) as PanelsApi['handle'],
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwards the same arguments to Topo's typed post; listeners only read the payload.
    post: ((event: string, payload?: unknown, options?: { panel?: string }) => {
      for (const listener of listeners) {
        listener(event, payload)
      }
      Reflect.apply(orca.panels.post, orca.panels, [event, payload, options])
    }) as PanelsApi['post']
  }
  const call: LocalCall = async (name, input) => {
    const handler = handlers.get(name)
    if (!handler) {
      throw new Error(`No hay un handler «${name}»`)
    }
    return handler(input, SCHEDULER_CONTEXT())
  }
  const bus: LocalBus = {
    next: (event, matches, timeoutMs) =>
      new Promise((resolve, reject) => {
        const listener = (name: string, payload: unknown) => {
          if (name === event && matches(payload)) {
            listeners.delete(listener)
            clearTimeout(timer)
            resolve(payload)
          }
        }
        const timer = setTimeout(() => {
          listeners.delete(listener)
          reject(new Error(`«${event}» no terminó en ${Math.round(timeoutMs / 60_000)} min`))
        }, timeoutMs)
        listeners.add(listener)
      })
  }
  return { orca: { ...orca, panels }, call, bus }
}
