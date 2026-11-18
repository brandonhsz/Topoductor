import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult
} from '../../../shared/notification-settings-types'
import { deliverAgentAttentionNotification } from './agent-attention-notification-delivery'
import { reconnectAttention } from './reconnect-attention-chime'

vi.mock('@/lib/blocked-notification-fallback', () => ({
  showBlockedNotificationFallbackToast: vi.fn()
}))

const HOST = 'runtime:env-1'
const dispatch = vi.fn<
  (request: NotificationDispatchRequest) => Promise<NotificationDispatchResult>
>(async () => ({ delivered: true }))
const playSound = vi.fn(async () => ({ played: true }))

beforeEach(() => {
  vi.stubGlobal('window', { api: { notifications: { dispatch, playSound } } })
})

afterEach(() => {
  reconnectAttention.forget(HOST)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function deliver(worktreeId: string, executionHost?: `runtime:${string}`): Promise<void> {
  deliverAgentAttentionNotification(
    { source: 'agent-task-complete', agentState: 'done', worktreeId, executionHost },
    { customSoundId: 'chime', customSoundVolume: null }
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function reconnectWithUnread(unreadWorkspaceIds: string[]): void {
  const now = Date.now()
  reconnectAttention.observe(HOST, { connected: true, unreadWorkspaceIds: [] }, now)
  reconnectAttention.observe(HOST, { connected: false, unreadWorkspaceIds: [] }, now)
  reconnectAttention.observe(HOST, { connected: true, unreadWorkspaceIds }, now)
}

describe('reconnect burst delivery', () => {
  it('sounds and bounces once for every completion a reconnect replays', async () => {
    reconnectWithUnread(['wt-a', 'wt-b', 'wt-c'])
    await deliver('wt-a', HOST)
    await deliver('wt-b', HOST)
    await deliver('wt-c', HOST)

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.map(([request]) => request.reconnectCoalesced)).toEqual([
      undefined,
      true,
      true
    ])
  })

  it('stays quiet for a reconnect that brought no new unread', async () => {
    reconnectWithUnread([])
    await deliver('wt-a', HOST)

    expect(playSound).not.toHaveBeenCalled()
    expect(dispatch.mock.calls[0]?.[0].reconnectCoalesced).toBe(true)
  })

  it('leaves hosts outside a reconnect and local work untouched', async () => {
    reconnectAttention.observe(HOST, { connected: true, unreadWorkspaceIds: [] }, Date.now())
    await deliver('wt-a', HOST)
    await deliver('wt-b')

    expect(playSound).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls.every(([request]) => !request.reconnectCoalesced)).toBe(true)
  })
})
