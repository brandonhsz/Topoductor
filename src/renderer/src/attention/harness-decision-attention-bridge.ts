/** Turn Harness runs that stop for a person's decision into one agent-attention alert each. */
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { HarnessRunSummary } from '../../../shared/harness/harness-run-types'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'
import { isStructuredTab } from '../../../shared/agent-session/view/structured-agent-session-tab'
import { structuredChatTabBySessionId } from '@/lib/structured-chat-tab-index'
import { structuredAgentSessionPaneKey } from '../../../shared/agent-session/view/structured-agent-session-projection'
import {
  buildHarnessDecisionDispatchRequest,
  detectHarnessDecisionAttention
} from './harness-decision-attention'
import {
  deliverAgentAttentionNotification,
  readAgentAttentionNotificationSound
} from './agent-attention-notification-delivery'
import { getNotificationWorkspaceLabels } from './notification-workspace-labels'

// Module-level so a remounted bridge never re-alerts a decision it already announced.
const lastSeenRunById = new Map<string, HarnessRunSummary>()

type StoreSnapshot = ReturnType<typeof useAppStore.getState>

/** Click opens the run's chat when its tab is open in the run's worktree, else the worktree. */
function chatSurfaceFor(
  state: StoreSnapshot,
  run: HarnessRunSummary
): Pick<NotificationDispatchRequest, 'surface' | 'paneKey'> {
  if (!run.chatSessionId) {
    return {}
  }
  const tab = structuredChatTabBySessionId(
    state.unifiedTabsByWorktree,
    run.worktreeId,
    run.chatSessionId
  )
  return tab && isStructuredTab(tab)
    ? { surface: 'agent-session', paneKey: structuredAgentSessionPaneKey(tab.id, tab.entityId) }
    : {}
}

export function handleHarnessRunChanged(run: HarnessRunSummary): void {
  const previous = lastSeenRunById.get(run.id)
  if (run.status === 'waiting' || run.status === 'running') {
    lastSeenRunById.set(run.id, run)
  } else {
    lastSeenRunById.delete(run.id)
  }
  const attention = detectHarnessDecisionAttention(previous, run)
  if (!attention) {
    return
  }
  const state = useAppStore.getState()
  const request: NotificationDispatchRequest = {
    ...buildHarnessDecisionDispatchRequest(
      run,
      attention,
      getNotificationWorkspaceLabels(state, run.worktreeId, run.flowName)
    ),
    notificationId: attention.attentionKey,
    terminalTitle: run.flowName,
    isActiveWorktree: state.activeWorktreeId === run.worktreeId,
    ...chatSurfaceFor(state, run)
  }
  // Main's dispatch owns the enabled/agentNeedsInput/host-mute gates and the Dock.
  deliverAgentAttentionNotification(
    request,
    readAgentAttentionNotificationSound(state.settings ?? {})
  )
}

export function subscribeHarnessDecisionAttention(): () => void {
  // Web and older shells expose no Harness bridge (or a no-op stub).
  const harness = window.api?.harness
  if (!harness?.onRunChanged) {
    return () => {}
  }
  return harness.onRunChanged(handleHarnessRunChanged)
}

export function HarnessDecisionAttentionBridge(): null {
  useEffect(() => subscribeHarnessDecisionAttention(), [])
  return null
}
