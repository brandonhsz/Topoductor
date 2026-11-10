import { PLUGIN_DECLARATIVE_MESSAGES } from '../plugin-declarative-message-names'
import { captureAtomValues } from './declarative-atoms'
import { readHostMessage } from './declarative-host-messages'
import type { TopoBridge, TopoDisposable } from './declarative-runtime-types'

/**
 * `topo plugin shot --act` changes the live panel; Topo asks this guest to remember its atoms
 * before acting (`ui.snapshot`) and to put them back after the capture (`ui.restore`). Only this
 * guest's atoms: what handlers did elsewhere (worker requests, storage writes) stays.
 */
export function actSnapshotSubscriptions(
  on: NonNullable<TopoBridge['on']>,
  document: string
): TopoDisposable[] {
  let restore: (() => void) | null = null
  const ours = (payload: unknown): boolean => readHostMessage(payload).document === document
  return [
    on(PLUGIN_DECLARATIVE_MESSAGES.snapshot, (payload) => {
      if (ours(payload)) {
        restore = captureAtomValues()
      }
    }),
    on(PLUGIN_DECLARATIVE_MESSAGES.restore, (payload) => {
      if (ours(payload) && restore) {
        const pending = restore
        restore = null
        pending()
      }
    })
  ]
}
