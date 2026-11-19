import type { CommandHandler } from '../dispatch'

function notImplemented(): never {
  throw new Error('not_implemented')
}

export const HARNESS_FLOW_HANDLERS: Record<string, CommandHandler> = {
  'harness flow list': async () => notImplemented(),
  'harness flow show': async () => notImplemented(),
  'harness flow save': async () => notImplemented()
}
