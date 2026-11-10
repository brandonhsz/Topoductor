import { isTopoSessionId, type TopoSessionId } from '../../../../../shared/topo-session-address'
import {
  clearedInto,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'

/** Address by the /clear root to preserve Runs and mail; without records, retain the supplied id. */
export function canonicalTopoSessionId(
  topoSessionId: TopoSessionId,
  store: Pick<
    AgentSessionRecordReader,
    'listRecords' | 'lineageRevision'
  > | null = readAgentSessionRecordStore()
): TopoSessionId {
  return createCanonicalTopoSessionResolver(store)(topoSessionId)
}

/** Clear edges per lineage revision: mail checks ask per message, and must not rescan every record each time. */
const clearEdgesByRevision = new WeakMap<object, ReadonlyMap<string, string>>()

export function createCanonicalTopoSessionResolver(
  store: Pick<AgentSessionRecordReader, 'listRecords' | 'lineageRevision'> | null
): (id: TopoSessionId) => TopoSessionId {
  if (!store) {
    return (id) => id
  }
  const revision = store.lineageRevision?.()
  let clearedFrom = revision ? clearEdgesByRevision.get(revision) : undefined
  if (!clearedFrom) {
    const edges = new Map<string, string>()
    for (const record of store.listRecords()) {
      const next = clearedInto(record)
      if (next) {
        edges.set(next, record.sessionId)
      }
    }
    clearedFrom = edges
    if (revision) {
      clearEdgesByRevision.set(revision, edges)
    }
  }
  const edges = clearedFrom
  return (id) => canonicalTopoSessionFromEdges(id, edges)
}

export function canonicalTopoSessionFromEdges(
  topoSessionId: TopoSessionId,
  clearedFrom: ReadonlyMap<string, string>
): TopoSessionId {
  // The visited set bounds corrupt chains; valid clear lineage is acyclic.
  let root: string = topoSessionId
  const earlier = new Set([root])
  let prior = clearedFrom.get(root)
  while (prior && !earlier.has(prior)) {
    earlier.add(prior)
    root = prior
    prior = clearedFrom.get(root)
  }
  // Record ids are minted as Topo session ids; one that is not cannot name the conversation.
  return isTopoSessionId(root) ? root : topoSessionId
}
