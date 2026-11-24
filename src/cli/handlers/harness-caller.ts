import { readFile } from 'node:fs/promises'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/agent-session-caller-env'

/** The flow belongs to a workspace: name it explicitly, or let the chat or terminal identify itself. */
export function callerParams(
  flags: Map<string, string | boolean>,
  isRemote: boolean
): { sessionId?: string; worktreeId?: string } {
  const worktreeId = getOptionalStringFlag(flags, 'worktree') ?? process.env.TOPO_WORKTREE_ID
  const sessionId = isRemote ? undefined : readInjectedAgentSessionId()
  if (!worktreeId && !sessionId) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Missing --worktree: this is not running inside a Topo workspace chat or terminal.'
    )
  }
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(worktreeId ? { worktreeId } : {})
  }
}

/** The host may not share this filesystem, so the file is read here. */
export function readCallerFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
