/** Collapse the completions a host replays on reconnect into one alert per host. */
export const RECONNECT_ATTENTION_SETTLE_MS = 10_000

/** Identifies the reconnect window a delivery claimed, so a late release cannot reopen a newer one. */
export type ReconnectWindow = { readonly settleUntil: number | null }

export type ReconnectAlertClaim = { coalesced: boolean; window?: ReconnectWindow }

export type ReconnectAttentionTracker = {
  observe(hostId: string, connected: boolean, now: number): void
  /** Claims the reconnect window's one alert; coalesced when another delivery already holds it, so this one stays quiet. */
  coalesceAlert(hostId: string, now: number): ReconnectAlertClaim
  /** Hands the claimed alert back when main did not sound it, only while that window is still current. */
  releaseAlert(hostId: string, window: ReconnectWindow): void
  forget(hostId: string): void
}

type HostState = {
  connected: boolean
  settleUntil: number | null
  alerted: boolean
}

export function createReconnectAttentionTracker(): ReconnectAttentionTracker {
  const hosts = new Map<string, HostState>()
  const settling = (hostId: string, now: number): HostState | undefined => {
    const host = hosts.get(hostId)
    return host?.connected && host.settleUntil !== null && now <= host.settleUntil
      ? host
      : undefined
  }

  return {
    observe(hostId, connected, now) {
      const host = hosts.get(hostId)
      if (!host || !connected) {
        hosts.set(hostId, { connected, settleUntil: null, alerted: false })
      } else if (!host.connected) {
        hosts.set(hostId, {
          connected,
          settleUntil: now + RECONNECT_ATTENTION_SETTLE_MS,
          alerted: false
        })
      }
    },
    coalesceAlert(hostId, now) {
      const host = settling(hostId, now)
      if (!host) {
        return { coalesced: false }
      }
      if (host.alerted) {
        return { coalesced: true }
      }
      host.alerted = true
      return { coalesced: false, window: host }
    },
    releaseAlert(hostId, window) {
      const host = hosts.get(hostId)
      if (host === window) {
        host.alerted = false
      }
    },
    forget(hostId) {
      hosts.delete(hostId)
    }
  }
}

/** Shared by the store bridge that observes hosts and the delivery path that asks whether to stay quiet. */
export const reconnectAttention = createReconnectAttentionTracker()
