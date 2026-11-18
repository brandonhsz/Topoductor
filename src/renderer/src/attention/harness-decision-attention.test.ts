import { describe, expect, it } from 'vitest'
import type { HarnessRunSummary } from '../../../shared/harness/harness-run-types'
import {
  buildHarnessDecisionDispatchRequest,
  detectHarnessDecisionAttention
} from './harness-decision-attention'

function run(overrides: Partial<HarnessRunSummary> = {}): HarnessRunSummary {
  return {
    id: 'run-1',
    flowId: 'flow-1',
    flowName: 'Intent to delivery',
    worktreeId: 'wt-42',
    status: 'running',
    createdAt: 1_000,
    updatedAt: 2_000,
    pendingCount: 0,
    mode: 'chat',
    chatSessionId: 'chat-9',
    ...overrides
  }
}

describe('detectHarnessDecisionAttention', () => {
  it('alerts when a waiting run gains a pending decision', () => {
    const previous = run({ status: 'running', pendingCount: 0 })
    const next = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 })

    expect(detectHarnessDecisionAttention(previous, next)).toEqual({
      attentionKey: 'harness:run-1:1:3000'
    })
  })

  it('alerts on the first sighting of a run already waiting on a decision', () => {
    const next = run({ status: 'waiting', pendingCount: 2, updatedAt: 5_000 })

    expect(detectHarnessDecisionAttention(undefined, next)).toEqual({
      attentionKey: 'harness:run-1:2:5000'
    })
  })

  it('alerts again when a second decision is added while still waiting', () => {
    const previous = run({ status: 'waiting', pendingCount: 1 })
    const next = run({ status: 'waiting', pendingCount: 2, updatedAt: 4_000 })

    expect(detectHarnessDecisionAttention(previous, next)).toEqual({
      attentionKey: 'harness:run-1:2:4000'
    })
  })

  it('stays quiet when waiting with the same pending count', () => {
    const previous = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 })
    const next = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_500 })

    expect(detectHarnessDecisionAttention(previous, next)).toBeNull()
  })

  it('stays quiet when the pending count drops while still waiting', () => {
    const previous = run({ status: 'waiting', pendingCount: 2 })
    const next = run({ status: 'waiting', pendingCount: 1 })

    expect(detectHarnessDecisionAttention(previous, next)).toBeNull()
  })

  it('stays quiet when a first-seen waiting run has no pending decisions', () => {
    expect(
      detectHarnessDecisionAttention(undefined, run({ status: 'waiting', pendingCount: 0 }))
    ).toBeNull()
  })

  it.each(['running', 'completed', 'failed', 'stopped'] as const)(
    'stays quiet for a %s run even if the pending count rises',
    (status) => {
      const previous = run({ status: 'waiting', pendingCount: 0 })
      const next = run({ status, pendingCount: 1 })

      expect(detectHarnessDecisionAttention(previous, next)).toBeNull()
    }
  )
})

describe('buildHarnessDecisionDispatchRequest', () => {
  const waitingRun = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 })
  const attention = { attentionKey: 'harness:run-1:1:3000' }
  const labels = { repoLabel: 'merfolk', worktreeLabel: 'mac-agent-notifications' }

  it('routes a waiting agent alert to the run worktree under the detected key', () => {
    expect(buildHarnessDecisionDispatchRequest(waitingRun, attention, labels)).toMatchObject({
      source: 'agent-task-complete',
      agentState: 'waiting',
      worktreeId: 'wt-42',
      attentionKey: 'harness:run-1:1:3000',
      repoLabel: 'merfolk',
      worktreeLabel: 'mac-agent-notifications'
    })
  })

  it('uses the worktree of whichever run it is given', () => {
    const other = run({ id: 'run-2', worktreeId: 'wt-77', status: 'waiting', pendingCount: 1 })

    expect(
      buildHarnessDecisionDispatchRequest(other, { attentionKey: 'harness:run-2:1:2000' }, {})
    ).toMatchObject({ worktreeId: 'wt-77', attentionKey: 'harness:run-2:1:2000' })
  })

  it('produces a stable attentionKey for the same run transition', () => {
    const previous = run({ status: 'running', pendingCount: 0 })
    const next = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 })

    const first = detectHarnessDecisionAttention(previous, next)
    const second = detectHarnessDecisionAttention({ ...previous }, { ...next })
    expect(first).not.toBeNull()
    expect(second).toEqual(first)

    const requestA = buildHarnessDecisionDispatchRequest(next, first!, labels)
    const requestB = buildHarnessDecisionDispatchRequest({ ...next }, second!, { ...labels })
    expect(requestA.attentionKey).toBe(first!.attentionKey)
    expect(requestB).toEqual(requestA)
  })
})
