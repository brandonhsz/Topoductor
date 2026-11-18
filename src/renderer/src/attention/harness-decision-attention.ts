import type { HarnessRunSummary } from '../../../shared/harness/harness-run-types'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'

export type HarnessDecisionAttention = { attentionKey: string }

/** A run newly waiting on a person's decision; repeats of the same pending set stay quiet. */
export function detectHarnessDecisionAttention(
  previous: HarnessRunSummary | undefined,
  next: HarnessRunSummary
): HarnessDecisionAttention | null {
  throw new Error(`detectHarnessDecisionAttention not implemented: ${previous?.id} ${next.id}`)
}

export function buildHarnessDecisionDispatchRequest(
  run: HarnessRunSummary,
  attention: HarnessDecisionAttention,
  labels: { repoLabel?: string; worktreeLabel?: string }
): NotificationDispatchRequest {
  throw new Error(
    `buildHarnessDecisionDispatchRequest not implemented: ${run.id} ${attention.attentionKey} ${labels.worktreeLabel}`
  )
}
