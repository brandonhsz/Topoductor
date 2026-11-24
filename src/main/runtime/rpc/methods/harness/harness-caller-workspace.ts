import type { TopoRuntimeService } from '../../../topo-runtime'

/** Chats carry only a session id; their workspace comes from the session record. */
export async function sessionWorkspace(
  runtime: TopoRuntimeService,
  sessionId: string | undefined
): Promise<string | null> {
  if (!sessionId) {
    return null
  }
  try {
    const store = await runtime.openAgentSessionRecordStore()
    return store.getConversation(sessionId)?.location.workspaceId ?? null
  } catch {
    return null
  }
}

export async function callerWorkspace(
  runtime: TopoRuntimeService,
  params: { sessionId?: string; worktreeId?: string }
): Promise<string | null> {
  return params.worktreeId ?? (await sessionWorkspace(runtime, params.sessionId))
}
