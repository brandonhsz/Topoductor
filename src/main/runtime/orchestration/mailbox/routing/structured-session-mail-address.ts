/**
 * A structured agent session as a mail address: `topo_session_id:<id>`, the Topo-minted id every agent is
 * told is its public address. Recipient routing and pointer delivery both read these rules off the
 * durable session record, so the two can never disagree about which sessions mail can reach.
 *
 * The address names a conversation, not one session of it: any session of a `/clear` lineage names
 * the lineage root's address (`canonicalTopoSessionId`), and mail reaches the lineage's live session.
 *
 * A released lease does not end a session: the host stops an idle chat's agent, and the send that
 * points its mail starts it again. For mail, a conversation has ended only when its chat was closed.
 */

import type { AgentSessionConversationView } from '../../../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import { isTopoSessionId, type TopoSessionId } from '../../../../../shared/topo-session-address'
import { ORCHESTRATION_SESSION_CALLER_ERROR_CODES as CODES } from '../../../../../shared/orchestration/orchestration-session-caller-codes'
import type { OrchestrationDb } from '../../db/orchestration-db'
import { OrchestrationError } from '../../orchestration-error'
import {
  resolveTopoSessionParty,
  type OrchestrationSessionParty
} from '../../addressing/orchestration-party'
import {
  resolveLineageRunningSession,
  type LineageRunningSession,
  type AgentSessionRecordReader
} from '../../addressing/session-lineage/structured-session-lineage'

export type TopoAgentSessionLookup =
  | { kind: 'found'; record: AgentSessionConversationView }
  /** The id is a provider's own session id, which rotates on `/clear`; this names the Topo id. */
  | { kind: 'provider-id'; topoSessionId: string }
  | { kind: 'unknown' }

export function lookupTopoAgentSession(
  store: AgentSessionRecordReader,
  id: string
): TopoAgentSessionLookup {
  const record = store.getRecord(id)
  if (record) {
    return { kind: 'found', record }
  }
  const owner = store
    .listRecords()
    .find((candidate) => candidate.providerHandleChain.some(({ handle }) => handle.nativeId === id))
  return owner ? { kind: 'provider-id', topoSessionId: owner.sessionId } : { kind: 'unknown' }
}

export type StructuredSessionMailReach =
  /** `session` is the conversation's live session, the one its mail reaches now. */
  | { kind: 'reachable'; session: AgentSessionConversationView }
  | { kind: 'other-host' }
  /** The lineage names a session with no record, or loops: not being able to look, not an end. */
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'ended'; reason: 'closed' | 'worker-identity-lost' }

/** Whether mail to `record`'s conversation can reach the session that runs it now. */
export function structuredSessionMailReach(
  store: AgentSessionRecordReader,
  record: AgentSessionConversationView,
  db: OrchestrationDb | null | undefined,
  canonicalStore?: Pick<AgentSessionRecordReader, 'listRecords'> | null
): StructuredSessionMailReach {
  return deriveStructuredSessionMailReach(
    resolveLineageRunningSession(store, record.sessionId),
    (id) => Boolean(addressableSessionParty(id, db, canonicalStore)),
    () => {
      // One keyed question per check, never every visible tab to find one.
      const retired = store.isSessionTabRetired
      if (retired) {
        return { present: true, isListed: (id: string) => !retired(id) }
      }
      const visible = store.getVisibleSessionTabIndex?.()
      return visible
        ? { present: visible.present, isListed: (id: string) => visible.sessionIds.includes(id) }
        : undefined
    }
  )
}

/** Read-only target admission, shared with consumers holding committed source facts. */
export function deriveStructuredSessionMailReach(
  running: LineageRunningSession,
  addressable: (id: TopoSessionId) => boolean,
  visibility: () => { present: boolean; isListed: (id: string) => boolean } | undefined
): StructuredSessionMailReach {
  if (running.kind === 'unverifiable') {
    return { kind: 'unverifiable', reason: running.reason }
  }
  if (running.kind === 'other-host') {
    return { kind: 'other-host' }
  }
  const live = running.record
  if (isTopoSessionId(live.sessionId) && !addressable(live.sessionId)) {
    // Lost worker identity cannot act through the caller resolver and therefore cannot read mail.
    return { kind: 'ended', reason: 'worker-identity-lost' }
  }
  const visible = visibility()
  if (visible?.present && !visible.isListed(live.sessionId)) {
    // Do not revive closed chats into invisible turns; their mail waits.
    return { kind: 'ended', reason: 'closed' }
  }
  return { kind: 'reachable', session: live }
}

/** Exclude only proven lost worker identity, which the party resolver refuses in every role. */
export function addressableSessionParty(
  sessionId: TopoSessionId,
  db: OrchestrationDb | null | undefined,
  store?: Pick<AgentSessionRecordReader, 'listRecords'> | null
): OrchestrationSessionParty | null {
  try {
    return resolveTopoSessionParty(sessionId, db, store)
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === CODES.notLive) {
      return null
    }
    throw error
  }
}
