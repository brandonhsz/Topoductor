// Derive Topo-stop cuts from the journal for Continue; never store them. Host rechecks under the session lock before sending.

import {
  readAgentSessionTopoStop,
  type AgentSessionTopoStopCause
} from '../agent-session/lifecycle/agent-session-topo-stop'
import { isRootAgentJournalItem } from '../agent-session/journal/agent-session-journal-producer'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../agent-session/journal/agent-session-journal-types'
import { STALE_SESSION_ROW_PREFIX } from '../agent-session/lifecycle/agent-session-stop-row-identity'
import {
  readAgentJournalTurn,
  readAgentJournalTurnOutcome
} from '../agent-session/lifecycle/agent-session-turn-record'
import {
  agentTurnVerdict,
  type AgentTurnOutcome
} from '../agent-status/lifecycle/agent-turn-outcome'
import {
  commandTurnsOf,
  type AgentJournalBodyLookup
} from '../agent-session/structured-agent-session-command-entry'
import {
  isStructuredAgentSessionNonRequestRow,
  type StructuredAgentSessionLatestRequest
} from '../agent-session/requests/structured-agent-session-latest-request'

// Dedupe shutdown rows by stopped child; preserve the legacy prefix so older clients add no duplicate notice.
export function topoShutdownRowClientMessageId(
  sessionId: string,
  fence: number,
  generation: string
): string {
  return `${STALE_SESSION_ROW_PREFIX}${sessionId}:shutdown-${fence}-${generation}`
}

export function topoStopCauseOfRow(item: AgentJournalRenderItem): AgentSessionTopoStopCause | null {
  return item.body.kind === 'status'
    ? (readAgentSessionTopoStop(item.body.topoStop)?.cause ?? null)
    : null
}

export type NativeChatTopoStopCut = {
  turnItemId: string
  cause: AgentSessionTopoStopCause
}

/** Latest root turn only if no later request or in-flight send exists; steers/conversation commands do not count as new requests. */
export function latestNativeChatTurnSinceRequest(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly Pick<AgentJournalSubmission, 'dispatchState'>[],
  /** With an indexed body read, only the turns this scan reaches are checked, not all history. */
  bodyOf?: AgentJournalBodyLookup
): { turnItem: AgentJournalRenderItem; verdict: AgentTurnOutcome | null } | null {
  if (submissions.some((submission) => submission.dispatchState === 'pending')) {
    return null
  }
  const commandTurns = commandTurnsOf(items, bodyOf)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (
      !isRootAgentJournalItem(item) ||
      isStructuredAgentSessionNonRequestRow(item, commandTurns)
    ) {
      continue
    }
    if (item.body.kind === 'message' && item.body.role === 'user') {
      return null
    }
    const turn = readAgentJournalTurn(item.body)
    if (turn) {
      return {
        turnItem: item,
        verdict: agentTurnVerdict({ state: turn.state, outcome: readAgentJournalTurnOutcome(turn) })
      }
    }
  }
  return null
}

export function findInNativeChatTurn<T>(
  items: readonly AgentJournalRenderItem[],
  turnItemId: string,
  read: (item: AgentJournalRenderItem) => T | null
): T | null {
  for (const item of items) {
    const inTurn = item.turnScope?.kind === 'turn' && item.turnScope.turnItemId === turnItemId
    const found = inTurn ? read(item) : null
    if (found !== null) {
      return found
    }
  }
  return null
}

export function latestNativeChatTopoStopCut(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly Pick<AgentJournalSubmission, 'dispatchState'>[],
  bodyOf?: AgentJournalBodyLookup
): NativeChatTopoStopCut | null {
  const latest = latestNativeChatTurnSinceRequest(items, submissions, bodyOf)
  if (!latest || latest.verdict !== 'interruption') {
    return null
  }
  const turnItemId = latest.turnItem.itemId
  const cause = findInNativeChatTurn(items, turnItemId, topoStopCauseOfRow)
  return cause ? { turnItemId, cause } : null
}

/** Intentional shutdown is cancellation in status; retain raw cut verdicts for Continue. */
export function nativeChatStatusTurnOutcome(
  request: StructuredAgentSessionLatestRequest | null,
  items: readonly AgentJournalRenderItem[],
  submissions: readonly Pick<AgentJournalSubmission, 'dispatchState'>[],
  bodyOf?: AgentJournalBodyLookup
): AgentTurnOutcome | null {
  const verdict = request
    ? agentTurnVerdict({ state: request.turnState, outcome: request.outcome })
    : null
  const stop =
    verdict === 'interruption' ? latestNativeChatTopoStopCut(items, submissions, bodyOf) : null
  return stop && stop.cause !== 'crash' ? 'cancellation' : verdict
}
