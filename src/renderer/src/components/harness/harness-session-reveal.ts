import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { openExistingStructuredSession } from '@/lib/open-existing-structured-session'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { useAppStore } from '@/store'
import type { HarnessAgentSessionRef } from '../../../../shared/harness/harness-run-types'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'

function unavailable(): void {
  toast.message(
    translate(
      'components.harness.sessionUnavailable',
      'This agent’s session is no longer open. Its output stays in the run.'
    )
  )
}

/** Leaves the Harness page for the workspace tab where the step's agent is working. */
export async function revealHarnessSession(session: HarnessAgentSessionRef): Promise<void> {
  if (session.kind === 'structured') {
    try {
      await openExistingStructuredSession(
        { workspaceId: session.worktreeId, sessionId: session.sessionId },
        {
          target: { kind: 'local' },
          initialize: () => Boolean(activateAndRevealWorkspace(session.worktreeId)),
          present: (outcome) => {
            if (outcome !== 'activated') {
              unavailable()
            }
          },
          onError: unavailable
        }
      )
    } catch {
      // The interaction reports its own failures through onError.
    }
    return
  }
  if (!activateAndRevealWorkspace(session.worktreeId)) {
    unavailable()
    return
  }
  const pane = session.paneKey ? parsePaneKey(session.paneKey) : null
  if (pane) {
    const store = useAppStore.getState()
    store.setActiveTab(pane.tabId)
    store.setActiveTabType('terminal', session.worktreeId)
  }
}
