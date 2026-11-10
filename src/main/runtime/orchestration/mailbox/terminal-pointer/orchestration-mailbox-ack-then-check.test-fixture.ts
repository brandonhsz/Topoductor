import type { TopoRuntimeService } from '../../../topo-runtime'
import {
  checkBoundMailbox,
  type MailboxCheckOptions
} from './orchestration-mailbox-check.test-fixture'

/** Acknowledge a held Delivery, then take the next batch with a plain check, as agents do. */
export async function ackThenCheck(
  runtime: TopoRuntimeService,
  deliveryId: string,
  options: MailboxCheckOptions = {}
) {
  await checkBoundMailbox(runtime, { ...options, ack: deliveryId })
  return checkBoundMailbox(runtime, options)
}
