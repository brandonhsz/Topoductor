// Key failure rows by start identity so readers never match by prose.

import { parseAgentJournalItemKey } from '../journal/agent-session-journal-item-key'
import type { AgentJournalItemIdentity } from '../journal/agent-session-journal-identity'

const START_FAILURE_ROW = 'start-failure:'

export function structuredAgentSessionStartFailureRowIdentity(
  startKey: string
): Extract<AgentJournalItemIdentity, { provider: 'topo' }> {
  return { provider: 'topo', clientMessageId: `${START_FAILURE_ROW}${startKey}` }
}

export function isStructuredAgentSessionStartFailureRow(itemId: string): boolean {
  const identity = parseAgentJournalItemKey(itemId)
  return identity?.provider === 'topo' && identity.clientMessageId.startsWith(START_FAILURE_ROW)
}
