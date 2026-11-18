import type { HarnessRunSummary } from '../../../shared/harness/harness-run-types'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'

export type HarnessDecisionAttention = { attentionKey: string }

/** A run newly waiting on a person's decision; repeats of the same pending set stay quiet. */
export function detectHarnessDecisionAttention(
  previous: HarnessRunSummary | undefined,
  next: HarnessRunSummary
): HarnessDecisionAttention | null {
  if (next.status !== 'waiting' || next.pendingCount <= (previous?.pendingCount ?? 0)) {
    return null
  }
  return { attentionKey: `harness:${next.id}:${next.pendingCount}:${next.updatedAt}` }
}

export function buildHarnessDecisionDispatchRequest(
  run: HarnessRunSummary,
  attention: HarnessDecisionAttention,
  labels: { repoLabel?: string; worktreeLabel?: string }
): NotificationDispatchRequest {
  return {
    source: 'agent-task-complete',
    agentState: 'waiting',
    worktreeId: run.worktreeId,
    attentionKey: attention.attentionKey,
    repoLabel: labels.repoLabel,
    worktreeLabel: labels.worktreeLabel
  }
}
