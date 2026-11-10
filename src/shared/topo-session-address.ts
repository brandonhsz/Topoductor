import { isAgentSessionId } from './agent-session/lifecycle/agent-session-record'
import { isTerminalHandle } from './terminal-handle-prefix'
import { TOPO_SESSION_ADDRESS_PREFIX } from './topo-session-address-prefix'

/** Topo-minted structured session identity (record id/TOPO_AGENT_SESSION_ID), never provider identity. Orchestration stores bare lineage-root ids after /clear,
 * not live replacement ids; derive mail spelling topo_session_id:<id> alongside run:/dispatch: addresses.
 * Resolve execution location from records. PTYs have no id today; never use pane keys because later agents inherit panes. */
export { TOPO_SESSION_ADDRESS_PREFIX }

declare const topoSessionIdBrand: unique symbol
declare const topoSessionAddressBrand: unique symbol

/** A bare Topo session id; only `isTopoSessionId` and `parseTopoSessionAddress` produce one. */
export type TopoSessionId = string & { readonly [topoSessionIdBrand]: true }
/** An `topo_session_id:<id>` mail address; only `formatTopoSessionAddress` produces one. */
export type TopoSessionAddress = string & { readonly [topoSessionAddressBrand]: true }

export function isTopoSessionId(id: string): id is TopoSessionId {
  return isAgentSessionId(id) && !isTerminalHandle(id)
}

export function formatTopoSessionAddress(topoSessionId: TopoSessionId): TopoSessionAddress {
  const address = `${TOPO_SESSION_ADDRESS_PREFIX}${topoSessionId}`
  // Always true for a checked id; the check brands the address without a type assertion.
  if (!isTopoSessionAddress(address)) {
    throw new Error(`Not a Topo session id: ${topoSessionId}`)
  }
  return address
}

/** The bare Topo session id of an `topo_session_id:<id>` address; anything else reads as null. */
export function parseTopoSessionAddress(address: string | null | undefined): TopoSessionId | null {
  if (!address?.startsWith(TOPO_SESSION_ADDRESS_PREFIX)) {
    return null
  }
  const id = address.slice(TOPO_SESSION_ADDRESS_PREFIX.length)
  return isTopoSessionId(id) ? id : null
}

function isTopoSessionAddress(address: string): address is TopoSessionAddress {
  return parseTopoSessionAddress(address) !== null
}
