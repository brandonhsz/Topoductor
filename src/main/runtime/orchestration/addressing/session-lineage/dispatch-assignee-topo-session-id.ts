import {
  parseTopoSessionAddress,
  type TopoSessionId
} from '../../../../../shared/topo-session-address'
import { structuredWorkerTopoSessionIdForIncarnation } from '../../terminal-authority/structured-sessions/structured-worker-identity'
import { canonicalTopoSessionId } from './canonical-topo-session-id'

/** Resolve structured incarnations or chat addresses to bare session ids; PTYs have none. */
export function dispatchAssigneeTopoSessionId(assignee: {
  handle: string
  processIncarnation: string | null | undefined
}): TopoSessionId | null {
  const topoSessionId =
    structuredWorkerTopoSessionIdForIncarnation(assignee.processIncarnation) ??
    parseTopoSessionAddress(assignee.handle)
  return topoSessionId === null ? null : canonicalTopoSessionId(topoSessionId)
}
