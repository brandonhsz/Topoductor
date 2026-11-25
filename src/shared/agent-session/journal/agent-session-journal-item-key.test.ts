import { describe, expect, it } from 'vitest'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey,
  boundJournalKeyComponent,
  parseAgentJournalItemKey
} from './agent-session-journal-item-key'

describe('journal item keys of chats Orca wrote', () => {
  it('reads an orca: item as Topo-authored and keeps addressing its stored key', () => {
    const key = 'orca:claude-tool%3A00000000-0000-4000-8000-00000000c1a0%3Atoolu_1'

    const identity = parseAgentJournalItemKey(key)

    expect(identity).toMatchObject({
      provider: 'topo',
      clientMessageId: 'claude-tool:00000000-0000-4000-8000-00000000c1a0:toolu_1'
    })
    expect(identity && agentJournalItemKey(identity)).toBe(key)
  })

  it('keeps an Orca bounded component verbatim', () => {
    const oversized = `${'a'.repeat(40)}~orca-oversized~2048~0123456789abcdef`
    const key = `claude:session-1:%FF${encodeURIComponent(oversized)}`

    const identity = parseAgentJournalItemKey(key)

    expect(identity).toMatchObject({ provider: 'claude', uuid: oversized })
    expect(identity && agentJournalItemKey(identity)).toBe(key)
  })

  it('still writes new items under topo:', () => {
    expect(agentJournalSubmissionKey('message-1')).toBe('topo:message-1')
    expect(boundJournalKeyComponent('x'.repeat(2000))).toContain('~topo-oversized~')
    const identity = parseAgentJournalItemKey('topo:message-1')
    expect(identity && agentJournalItemKey(identity)).toBe('topo:message-1')
  })
})
