import {
  formatTopoSessionAddress,
  isTopoSessionId
} from '../../../../../shared/topo-session-address'
import type { OrchestrationSessionAddressResult } from '../../../../../shared/orchestration/orchestration-caller-status'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '../../rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

/**
 * A chat's Topo session ID: its `/clear` root's, which the host derives from the session records.
 * Null for an id that is not a Topo session id.
 */
export async function resolveStructuredSessionTopoSessionId(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<string | null> {
  if (!isTopoSessionId(sessionId)) {
    return null
  }
  try {
    const result = await callRuntimeRpc<OrchestrationSessionAddressResult>(
      target,
      'orchestration.sessionAddress',
      { sessionId }
    )
    return result.topoSessionId
  } catch (error) {
    // Why: a host that predates the method routes the current session's ID to the same chat.
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return formatTopoSessionAddress(sessionId)
    }
    throw error
  }
}
