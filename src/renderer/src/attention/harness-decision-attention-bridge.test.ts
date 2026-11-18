import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessRunSummary } from '../../../shared/harness/harness-run-types'

const deliver = vi.fn()
const storeState: {
  activeWorktreeId: string | null
  settings: { notifications: { customSoundId: string; customSoundVolume: number } }
  unifiedTabsByWorktree: Record<string, unknown[]>
} = {
  activeWorktreeId: null,
  settings: { notifications: { customSoundId: 'two-tone', customSoundVolume: 0.5 } },
  unifiedTabsByWorktree: {}
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => storeState } }))
vi.mock('./agent-attention-notification-delivery', () => ({
  deliverAgentAttentionNotification: (...args: unknown[]) => deliver(...args),
  readAgentAttentionNotificationSound: () => ({ customSoundId: 'two-tone', customSoundVolume: 0.5 })
}))
vi.mock('./notification-workspace-labels', () => ({
  getNotificationWorkspaceLabels: () => ({ repoLabel: 'merfolk', worktreeLabel: 'feature' })
}))

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
    chatSessionId: null,
    ...overrides
  }
}

let emit: (summary: HarnessRunSummary) => void

async function subscribe(): Promise<() => void> {
  const { subscribeHarnessDecisionAttention } = await import('./harness-decision-attention-bridge')
  return subscribeHarnessDecisionAttention()
}

describe('harness decision attention bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    deliver.mockReset()
    storeState.activeWorktreeId = null
    storeState.unifiedTabsByWorktree = {}
    const onRunChanged = vi.fn((callback: (summary: HarnessRunSummary) => void) => {
      emit = callback
      return () => {}
    })
    vi.stubGlobal('window', { api: { harness: { onRunChanged } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('alerts once for a run that starts waiting on a decision', async () => {
    await subscribe()
    emit(run())
    const waiting = run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 })
    emit(waiting)
    emit(waiting)
    emit({ ...waiting, updatedAt: 3_500 })

    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent-task-complete',
        agentState: 'waiting',
        worktreeId: 'wt-42',
        attentionKey: 'harness:run-1:1:3000',
        repoLabel: 'merfolk',
        worktreeLabel: 'feature',
        isActiveWorktree: false
      }),
      { customSoundId: 'two-tone', customSoundVolume: 0.5 }
    )
  })

  it('alerts again only after the decision is answered and a new one is raised', async () => {
    await subscribe()
    emit(run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 }))
    emit(run({ status: 'running', pendingCount: 0, updatedAt: 4_000 }))
    emit(run({ status: 'waiting', pendingCount: 1, updatedAt: 5_000 }))

    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('keeps dedupe across a bridge remount', async () => {
    const off = await subscribe()
    emit(run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 }))
    off()
    const { subscribeHarnessDecisionAttention } =
      await import('./harness-decision-attention-bridge')
    subscribeHarnessDecisionAttention()
    emit(run({ status: 'waiting', pendingCount: 1, updatedAt: 3_000 }))

    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('routes the click to the run chat when its tab is open', async () => {
    storeState.unifiedTabsByWorktree = {
      'wt-42': [
        {
          id: 'tab-7',
          entityId: 'chat-9',
          contentType: 'agent-session',
          agentSessionAgent: 'claude'
        }
      ]
    }
    await subscribe()
    emit(run({ status: 'waiting', pendingCount: 1, chatSessionId: 'chat-9' }))

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'agent-session', worktreeId: 'wt-42' }),
      expect.anything()
    )
  })

  it('ignores worktree and session ids that name Object.prototype members', async () => {
    await subscribe()

    expect(() =>
      emit(
        run({
          status: 'waiting',
          pendingCount: 1,
          worktreeId: 'constructor',
          chatSessionId: 'constructor'
        })
      )
    ).not.toThrow()
    expect(deliver).toHaveBeenCalledWith(
      expect.not.objectContaining({ surface: 'agent-session' }),
      expect.anything()
    )
  })

  it('does nothing without a Harness bridge', async () => {
    vi.stubGlobal('window', { api: {} })
    const off = await subscribe()

    expect(off).toBeTypeOf('function')
    expect(deliver).not.toHaveBeenCalled()
  })
})
