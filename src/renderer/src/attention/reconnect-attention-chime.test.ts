import { describe, expect, it } from 'vitest'
import {
  RECONNECT_ATTENTION_SETTLE_MS,
  createReconnectAttentionTracker,
  type ReconnectAttentionTracker
} from './reconnect-attention-chime'

const T0 = 1_000_000

function connected(...unreadWorkspaceIds: string[]) {
  return { connected: true, unreadWorkspaceIds }
}

function disconnected(...unreadWorkspaceIds: string[]) {
  return { connected: false, unreadWorkspaceIds }
}

/** A host that was seen connected, then dropped, so the next ready sample is a reconnect. */
function trackerAfterOutage(hostId: string, ...unreadBefore: string[]): ReconnectAttentionTracker {
  const tracker = createReconnectAttentionTracker()
  expect(tracker.observe(hostId, connected(...unreadBefore), T0)).toBeNull()
  expect(tracker.observe(hostId, disconnected(...unreadBefore), T0 + 1_000)).toBeNull()
  return tracker
}

describe('createReconnectAttentionTracker', () => {
  it('chimes once when a host reconnects with one new unread workspace', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected('wt-1'), T0 + 60_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-1']
    })
  })

  it('chimes once for several new unread workspaces, not once per workspace', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected('wt-3', 'wt-1', 'wt-2'), T0 + 60_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-1', 'wt-2', 'wt-3']
    })
  })

  it('stays quiet when the host reconnects with no unread at all', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected(), T0 + 60_000)).toBeNull()
  })

  it('stays quiet when the only unread was already unread before the outage', () => {
    const tracker = trackerAfterOutage('host-a', 'wt-old')

    expect(tracker.observe('host-a', connected('wt-old'), T0 + 60_000)).toBeNull()
  })

  it('counts only workspaces that were not unread before the outage', () => {
    const tracker = trackerAfterOutage('host-a', 'wt-old')

    expect(tracker.observe('host-a', connected('wt-old', 'wt-new'), T0 + 60_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-new']
    })
  })

  it('catches unread that lands after the ready sample while hydration settles', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected(), T0 + 60_000)).toBeNull()
    expect(tracker.observe('host-a', connected('wt-1'), T0 + 62_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-1']
    })
  })

  it('does not chime again for unread that keeps arriving after it already chimed', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected('wt-1'), T0 + 60_000)).not.toBeNull()
    expect(tracker.observe('host-a', connected('wt-1', 'wt-2'), T0 + 61_000)).toBeNull()
    expect(tracker.observe('host-a', connected('wt-1', 'wt-2'), T0 + 62_000)).toBeNull()
  })

  it('leaves unread arriving after the settle window to the live emitters', () => {
    const tracker = trackerAfterOutage('host-a')
    const ready = T0 + 60_000

    expect(tracker.observe('host-a', connected(), ready)).toBeNull()
    expect(
      tracker.observe('host-a', connected('wt-1'), ready + RECONNECT_ATTENTION_SETTLE_MS + 1)
    ).toBeNull()
  })

  it('never chimes on the first sighting of a host (startup is not a reconnect)', () => {
    const tracker = createReconnectAttentionTracker()

    expect(tracker.observe('host-a', connected('wt-1', 'wt-2'), T0)).toBeNull()
  })

  it('never chimes for a host that stays connected and gains unread', () => {
    const tracker = createReconnectAttentionTracker()

    expect(tracker.observe('host-a', connected(), T0)).toBeNull()
    expect(tracker.observe('host-a', connected('wt-1'), T0 + 1_000)).toBeNull()
  })

  it('never chimes while the host is still disconnected', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', disconnected('wt-1'), T0 + 30_000)).toBeNull()
  })

  it('chimes again on a second, separate reconnect with new unread', () => {
    const tracker = trackerAfterOutage('host-a')

    expect(tracker.observe('host-a', connected('wt-1'), T0 + 60_000)).not.toBeNull()
    expect(tracker.observe('host-a', disconnected('wt-1'), T0 + 120_000)).toBeNull()
    expect(tracker.observe('host-a', connected('wt-1', 'wt-2'), T0 + 180_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-2']
    })
  })

  it('treats a workspace read during the outage and unread again on reconnect as new', () => {
    const tracker = trackerAfterOutage('host-a', 'wt-1')

    expect(tracker.observe('host-a', disconnected(), T0 + 30_000)).toBeNull()
    expect(tracker.observe('host-a', connected('wt-1'), T0 + 60_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-1']
    })
  })

  it('tracks each host on its own: one chime per reconnected host', () => {
    const tracker = createReconnectAttentionTracker()
    tracker.observe('host-a', connected(), T0)
    tracker.observe('host-b', connected(), T0)
    tracker.observe('host-a', disconnected(), T0 + 1_000)
    tracker.observe('host-b', disconnected(), T0 + 1_000)

    expect(tracker.observe('host-a', connected('wt-a'), T0 + 60_000)).toEqual({
      hostId: 'host-a',
      newUnreadWorkspaceIds: ['wt-a']
    })
    expect(tracker.observe('host-b', connected('wt-b'), T0 + 60_000)).toEqual({
      hostId: 'host-b',
      newUnreadWorkspaceIds: ['wt-b']
    })
    expect(tracker.observe('host-a', connected('wt-a'), T0 + 61_000)).toBeNull()
  })

  it('does not let one host reconnecting arm another host that never dropped', () => {
    const tracker = createReconnectAttentionTracker()
    tracker.observe('host-a', connected(), T0)
    tracker.observe('host-b', connected(), T0)
    tracker.observe('host-a', disconnected(), T0 + 1_000)
    tracker.observe('host-a', connected(), T0 + 60_000)

    expect(tracker.observe('host-b', connected('wt-b'), T0 + 61_000)).toBeNull()
  })

  it('forgets a removed host so it cannot chime from stale state', () => {
    const tracker = trackerAfterOutage('host-a')
    tracker.forget('host-a')

    expect(tracker.observe('host-a', connected('wt-1'), T0 + 60_000)).toBeNull()
  })
})
