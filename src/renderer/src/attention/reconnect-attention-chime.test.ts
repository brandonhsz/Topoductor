import { describe, expect, it } from 'vitest'
import {
  RECONNECT_ATTENTION_SETTLE_MS,
  createReconnectAttentionTracker,
  type ReconnectAlertClaim,
  type ReconnectAttentionTracker,
  type ReconnectWindow
} from './reconnect-attention-chime'

const T0 = 1_000_000
const READY = T0 + 60_000

/** A host that was seen connected, dropped, and reconnected at READY. */
function trackerAfterReconnect(hostId: string): ReconnectAttentionTracker {
  const tracker = createReconnectAttentionTracker()
  tracker.observe(hostId, true, T0)
  tracker.observe(hostId, false, T0 + 1_000)
  tracker.observe(hostId, true, READY)
  return tracker
}

function claimedWindow({ window }: ReconnectAlertClaim): ReconnectWindow {
  if (!window) {
    throw new Error('expected this delivery to claim the alert')
  }
  return window
}

describe('createReconnectAttentionTracker', () => {
  it('lets the first alert of a reconnect window through and quiets the rest', () => {
    const tracker = trackerAfterReconnect('host-a')

    expect(tracker.coalesceAlert('host-a', READY).coalesced).toBe(false)
    expect(tracker.coalesceAlert('host-a', READY + 1_000).coalesced).toBe(true)
    expect(tracker.coalesceAlert('host-a', READY + 2_000).coalesced).toBe(true)
  })

  it('hands a released alert to the next delivery of the window', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.releaseAlert('host-a', claimedWindow(tracker.coalesceAlert('host-a', READY)))

    expect(tracker.coalesceAlert('host-a', READY + 1_000).coalesced).toBe(false)
    expect(tracker.coalesceAlert('host-a', READY + 2_000).coalesced).toBe(true)
  })

  it('ignores a release from an earlier window once the host reconnected again', () => {
    const tracker = trackerAfterReconnect('host-a')
    const earlier = tracker.coalesceAlert('host-a', READY)
    tracker.observe('host-a', false, READY + 1_000)
    tracker.observe('host-a', true, READY + 2_000)
    expect(tracker.coalesceAlert('host-a', READY + 2_000).coalesced).toBe(false)
    tracker.releaseAlert('host-a', claimedWindow(earlier))

    expect(tracker.coalesceAlert('host-a', READY + 4_000).coalesced).toBe(true)
  })

  it('leaves alerts after the settle window to the live emitters', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.coalesceAlert('host-a', READY)
    const after = READY + RECONNECT_ATTENTION_SETTLE_MS + 1

    expect(tracker.coalesceAlert('host-a', after).coalesced).toBe(false)
    expect(tracker.coalesceAlert('host-a', after).coalesced).toBe(false)
  })

  it('never opens a window on the first sighting of a host (startup is not a reconnect)', () => {
    const tracker = createReconnectAttentionTracker()
    tracker.observe('host-a', true, T0)

    expect(tracker.coalesceAlert('host-a', T0).coalesced).toBe(false)
    expect(tracker.coalesceAlert('host-a', T0).coalesced).toBe(false)
  })

  it('never coalesces while the host is still disconnected', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.coalesceAlert('host-a', READY)
    tracker.observe('host-a', false, READY + 1_000)

    expect(tracker.coalesceAlert('host-a', READY + 2_000).coalesced).toBe(false)
  })

  it('opens a fresh window on a second, separate reconnect', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.coalesceAlert('host-a', READY)
    tracker.observe('host-a', false, READY + 60_000)
    tracker.observe('host-a', true, READY + 120_000)

    expect(tracker.coalesceAlert('host-a', READY + 120_000).coalesced).toBe(false)
    expect(tracker.coalesceAlert('host-a', READY + 121_000).coalesced).toBe(true)
  })

  it('tracks each host on its own', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.observe('host-b', true, T0)
    tracker.observe('host-b', false, T0 + 1_000)
    tracker.observe('host-b', true, READY)
    tracker.coalesceAlert('host-a', READY)

    expect(tracker.coalesceAlert('host-b', READY).coalesced).toBe(false)
  })

  it('does not let one host reconnecting arm another host that never dropped', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.observe('host-b', true, T0)
    tracker.coalesceAlert('host-b', READY)

    expect(tracker.coalesceAlert('host-b', READY).coalesced).toBe(false)
  })

  it('forgets a removed host so it cannot coalesce from stale state', () => {
    const tracker = trackerAfterReconnect('host-a')
    tracker.coalesceAlert('host-a', READY)
    tracker.forget('host-a')

    expect(tracker.coalesceAlert('host-a', READY).coalesced).toBe(false)
  })
})
