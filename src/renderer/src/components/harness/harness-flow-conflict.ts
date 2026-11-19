import type { HarnessFlowChange } from '../../../../shared/harness/harness-flow-version-types'

export type HarnessFlowChangeReaction = 'ignore' | 'reload' | 'ask'

/** How the editor reacts to a saved flow changing under it; local edits are never overwritten silently. */
export function harnessFlowChangeReaction({
  change,
  openFlowId,
  hasLocalEdits
}: {
  change: HarnessFlowChange | null
  openFlowId: string | null
  hasLocalEdits: boolean
}): HarnessFlowChangeReaction {
  if (!change) {
    return hasLocalEdits ? 'ignore' : 'reload'
  }
  if (!openFlowId || change.flowId !== openFlowId) {
    return 'ignore'
  }
  if (!hasLocalEdits) {
    return 'reload'
  }
  // A person change with local edits is the echo of this editor's own autosave.
  return change.source === 'agent' ? 'ask' : 'ignore'
}
