import { isTopoSessionId, type TopoSessionId } from './topo-session-address'

/** A literal Topo session id for a test, checked by the same predicate production uses. */
export function testTopoSessionId(id: string): TopoSessionId {
  if (!isTopoSessionId(id)) {
    throw new Error(`Not a Topo session id: ${id}`)
  }
  return id
}
