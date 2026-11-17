import type { WorktreeCreationRequest } from './pending-worktree-creation'

/** Starts the chat-driven Harness run before the chat launches, so its launch loads the flow. */
export async function startHarnessRunForCreatedWorktree(
  request: Pick<WorktreeCreationRequest, 'harnessStart'>,
  worktreeId: string
): Promise<void> {
  if (!request.harnessStart) {
    return
  }
  await window.api.harness
    .startRun({
      flowId: request.harnessStart.flowId,
      worktreeId,
      fields: request.harnessStart.fields,
      mode: 'chat',
      chatSessionId: null
    })
    .catch((error: unknown) => {
      console.error('worktree create: Harness flow did not start', worktreeId, error)
    })
}
