import {
  formatTopoSessionAddress,
  isTopoSessionId,
  parseTopoSessionAddress,
  type TopoSessionId
} from '../../../../shared/topo-session-address'
import { ORCHESTRATION_SESSION_CALLER_ERROR_CODES as CODES } from '../../../../shared/orchestration/orchestration-session-caller-codes'
import {
  isRecordedStructuredWorkerSession,
  resolveStructuredWorkerIdentity,
  resolveStructuredWorkerIdentityForRoot
} from '../terminal-authority/structured-sessions/structured-worker-authority'
import type { StructuredWorkerIdentity } from '../terminal-authority/structured-sessions/structured-worker-identity'
import { canonicalTopoSessionId } from './session-lineage/canonical-topo-session-id'
import type { AgentSessionRecordReader } from './session-lineage/structured-session-lineage'
import type { OrchestrationDb } from '../db/orchestration-db'
import { mailboxAddressOf } from './orchestration-caller-identity'
import type { OrchestrationPartyIdentity as OrchestrationParty } from '../../../../shared/orchestration/mailbox/orchestration-party-identity'
import { OrchestrationError } from '../orchestration-error'

/** A party named by a Topo session id: a structured worker, or a chat. */
export type OrchestrationSessionParty = OrchestrationParty &
  Readonly<{ topoSessionId: TopoSessionId }>

const NO_EFFECTS = { effectsApplied: false } as const

/** Every param naming a party other than the caller; a new one is added here with its own test. */
export const ORCHESTRATION_TARGET_PARAM: Readonly<
  Record<string, 'to' | 'terminal' | 'sessionId' | 'address'>
> = {
  'orchestration.send': 'to',
  'orchestration.ask': 'to',
  'orchestration.dispatch': 'to',
  'orchestration.inbox': 'terminal',
  'orchestration.sessionAddress': 'sessionId',
  'orchestration.partyLocation': 'address',
  'orchestration.partyOpen': 'address',
  'orchestration.workerStart': 'terminal'
}

/** The party a Topo session id names. Throws when it is a worker this host lost the identity of. */
export function resolveTopoSessionParty(
  topoSessionId: TopoSessionId,
  db: OrchestrationDb | null | undefined,
  store?: Pick<AgentSessionRecordReader, 'listRecords'> | null
): OrchestrationSessionParty {
  const id = canonicalTopoSessionId(topoSessionId, store)
  const worker = resolveStructuredWorkerIdentityForRoot(id, db)
  const party = sessionPartyFromWorkerIdentity(
    id,
    worker,
    !worker && Boolean(db && isRecordedStructuredWorkerSession(id, db))
  )
  if (!party) {
    // Without its handle, one worker would split into two parties and bind as a chat.
    throw new OrchestrationError(
      CODES.notLive,
      `Agent session ${id} is a structured worker whose worker identity this host no longer has, so orchestration cannot address it. No effects were applied.`,
      NO_EFFECTS
    )
  }
  return party
}

export function sessionPartyFromWorkerIdentity(
  id: TopoSessionId,
  worker: Pick<StructuredWorkerIdentity, 'handle' | 'paneKey'> | null,
  recordedWorker: boolean
): OrchestrationSessionParty | undefined {
  if (!worker && recordedWorker) {
    return undefined
  }
  const key = { terminalHandle: worker?.handle ?? null, topoSessionId: id }
  return {
    ...key,
    address: mailboxAddressOf(key) ?? formatTopoSessionAddress(id),
    paneKey: worker?.paneKey ?? null
  }
}

/** The party an address names; a PTY handle is itself and costs no lookup. */
export function resolveOrchestrationParty(
  address: string,
  db: OrchestrationDb | null | undefined
): OrchestrationParty {
  const topoSessionId = parseTopoSessionAddress(address)
  if (topoSessionId) {
    return resolveTopoSessionParty(topoSessionId, db)
  }
  const worker = resolveStructuredWorkerIdentity(address, db)
  return {
    address,
    terminalHandle: address,
    paneKey: worker?.paneKey ?? null,
    topoSessionId:
      worker && isTopoSessionId(worker.sessionId) ? canonicalTopoSessionId(worker.sessionId) : null
  }
}

/** How a preamble names a party: a session by its Topo session ID (its `/clear` root), else its handle. */
export function topoSessionIdOrHandle(
  address: string,
  db: OrchestrationDb | null | undefined
): string {
  const { topoSessionId } = resolveOrchestrationParty(address, db)
  return topoSessionId === null ? address : formatTopoSessionAddress(topoSessionId)
}

/** A caller named by a param: naming a chat's address proves nothing, unlike its own session id. */
export function resolveDeclaredCallerParty(
  address: string,
  db: OrchestrationDb | null | undefined
): OrchestrationParty {
  const party = resolveOrchestrationParty(address, db)
  if (party.terminalHandle === null) {
    throw new OrchestrationError(
      CODES.chatNotDeclarable,
      `Agent session ${party.topoSessionId} is a chat, and a chat is identified only by the Topo session ID its own environment sends, never by naming it. No effects were applied.`,
      NO_EFFECTS
    )
  }
  return party
}

/** Resolve terminals, workers and chats; chat assignments use the /clear root address for later reports. */
export function resolveDispatchAssigneeParty(
  address: string,
  db: OrchestrationDb | null | undefined
): OrchestrationParty {
  return resolveOrchestrationParty(address, db)
}
