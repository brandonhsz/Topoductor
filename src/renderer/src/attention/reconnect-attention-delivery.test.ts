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

function deliver(worktreeId: string, executionHost?: `runtime:${string}`): Promise<void> {
  deliverAgentAttentionNotification(
    { source: 'agent-task-complete', agentState: 'done', worktreeId, executionHost },
    { customSoundId: 'chime', customSoundVolume: null }
  )
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function reconnect(): void {
  const now = Date.now()
  reconnectAttention.observe(HOST, true, now)
  reconnectAttention.observe(HOST, false, now)
  reconnectAttention.observe(HOST, true, now)
}

describe('reconnect burst delivery', () => {
  it('sounds and bounces once for every completion a reconnect replays', async () => {
    reconnect()
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

  it('sounds the first alert after a reconnect, whatever the store saw as unread', async () => {
    reconnect()
    await deliver('wt-a', HOST)

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]?.[0].reconnectCoalesced).toBeUndefined()
  })

  it('keeps the alert for the next delivery when main did not sound the first one', async () => {
    dispatch.mockResolvedValueOnce({ delivered: false, reason: 'cooldown' })
    reconnect()
    await deliver('wt-a', HOST)
    await deliver('wt-b', HOST)

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.map(([request]) => request.reconnectCoalesced)).toEqual([
      undefined,
      undefined
    ])
  })

  it('sends only the first of a racing burst uncoalesced, so main bounces and sounds once', async () => {
    reconnect()
    await Promise.all([deliver('wt-a', HOST), deliver('wt-b', HOST), deliver('wt-c', HOST)])

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.map(([request]) => request.reconnectCoalesced)).toEqual([
      undefined,
      true,
      true
    ])
  })

  it('releases the alert when main did not sound it, even while the burst races', async () => {
    dispatch.mockResolvedValueOnce({ delivered: false, reason: 'cooldown' })
    reconnect()
    await deliver('wt-a', HOST)
    await Promise.all([deliver('wt-b', HOST), deliver('wt-c', HOST)])

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.map(([request]) => request.reconnectCoalesced)).toEqual([
      undefined,
      undefined,
      true
    ])
  })

  it('leaves hosts outside a reconnect and local work untouched', async () => {
    reconnectAttention.observe(HOST, true, Date.now())
    await deliver('wt-a', HOST)
    await deliver('wt-b')

    expect(playSound).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls.every(([request]) => !request.reconnectCoalesced)).toBe(true)
  })
})
