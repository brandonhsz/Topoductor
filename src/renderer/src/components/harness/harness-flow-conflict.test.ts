import { describe, expect, it } from 'vitest'
import type { HarnessFlowChange } from '../../../../shared/harness/harness-flow-version-types'
import { harnessFlowChangeReaction } from './harness-flow-conflict'

function change(overrides: Partial<HarnessFlowChange> = {}): HarnessFlowChange {
  return {
    flowId: 'flow-open',
    kind: 'saved',
    source: 'agent',
    summary: 'Added a review node',
    updatedAt: 1_700_000_000_000,
    ...overrides
  }
}

describe('harnessFlowChangeReaction', () => {
  it('asks when an agent changes the open flow while there are local edits', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'agent' }),
        openFlowId: 'flow-open',
        hasLocalEdits: true
      })
    ).toBe('ask')
  })

  it('reloads an agent change to the open flow when there are no local edits', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'agent' }),
        openFlowId: 'flow-open',
        hasLocalEdits: false
      })
    ).toBe('reload')
  })

  it('reloads a person change to the open flow when there are no local edits', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'person', kind: 'restored' }),
        openFlowId: 'flow-open',
        hasLocalEdits: false
      })
    ).toBe('reload')
  })

  it('ignores the echo of its own autosave on the open flow', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'person' }),
        openFlowId: 'flow-open',
        hasLocalEdits: true
      })
    ).toBe('ignore')
  })

  it('ignores an agent change to a flow other than the open one, even with local edits', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'agent', flowId: 'flow-other' }),
        openFlowId: 'flow-open',
        hasLocalEdits: true
      })
    ).toBe('ignore')
  })

  it('ignores an agent change when no flow is open', () => {
    expect(
      harnessFlowChangeReaction({
        change: change({ source: 'agent' }),
        openFlowId: null,
        hasLocalEdits: false
      })
    ).toBe('ignore')
  })

  it('reloads a change event without payload when there are no local edits', () => {
    expect(
      harnessFlowChangeReaction({ change: null, openFlowId: 'flow-open', hasLocalEdits: false })
    ).toBe('reload')
  })

  it('ignores a change event without payload when there are local edits', () => {
    expect(
      harnessFlowChangeReaction({ change: null, openFlowId: 'flow-open', hasLocalEdits: true })
    ).toBe('ignore')
  })
})
