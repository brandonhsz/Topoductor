/** Collapse the completions a host replays on reconnect into one alert per host. */
export const RECONNECT_ATTENTION_SETTLE_MS = 10_000

export type HostAttentionSample = {
  connected: boolean
  unreadWorkspaceIds: readonly string[]
}

export type ReconnectAttention = { hostId: string; newUnreadWorkspaceIds: string[] }

export type ReconnectAttentionTracker = {
  observe(hostId: string, sample: HostAttentionSample, now: number): ReconnectAttention | null
  /** True when a delivery from this host must stay quiet because its reconnect alert is already spent. */
  coalesceAlert(hostId: string, now: number): boolean
  forget(hostId: string): void
}

type HostState = {
  connected: boolean
  baseline: ReadonlySet<string>
  settleUntil: number | null
  chimed: boolean
  alertOwed: boolean
}

export function createReconnectAttentionTracker(): ReconnectAttentionTracker {
  const hosts = new Map<string, HostState>()
  const settling = (host: HostState | undefined, now: number): host is HostState =>
    host !== undefined && host.connected && host.settleUntil !== null && now <= host.settleUntil

  return {
    observe(hostId, sample, now) {
      const host = hosts.get(hostId)
      if (!host || !sample.connected) {
        hosts.set(hostId, {
          connected: sample.connected,
          baseline: new Set(sample.unreadWorkspaceIds),
          settleUntil: null,
          chimed: false,
          alertOwed: false
        })
        return null
      }
      if (!host.connected) {
        host.connected = true
        host.settleUntil = now + RECONNECT_ATTENTION_SETTLE_MS
        host.chimed = false
      }
      if (!settling(host, now) || host.chimed) {
        return null
      }
      const fresh = sample.unreadWorkspaceIds.filter((id) => !host.baseline.has(id)).sort()
      if (fresh.length === 0) {
        return null
      }
      host.chimed = true
      host.alertOwed = true
      return { hostId, newUnreadWorkspaceIds: fresh }
    },
    coalesceAlert(hostId, now) {
      const host = hosts.get(hostId)
      if (!settling(host, now)) {
        return false
      }
      // The first replayed delivery carries the host's one alert; the rest of the burst stays quiet.
      const owed = host.alertOwed
      host.alertOwed = false
      return !owed
    },
    forget(hostId) {
      hosts.delete(hostId)
    }
  }
}

/** Shared by the store bridge that observes hosts and the delivery path that asks whether to stay quiet. */
export const reconnectAttention = createReconnectAttentionTracker()
