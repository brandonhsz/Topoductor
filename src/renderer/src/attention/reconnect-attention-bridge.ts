/** Feed each paired host's connection to the reconnect tracker before delivery reads it. */
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import { reconnectAttention } from './reconnect-attention-chime'

type StoreSnapshot = ReturnType<typeof useAppStore.getState>

let observedHostIds = new Set<string>()

export function observeReconnectAttention(state: StoreSnapshot, now: number): void {
  const hostIds = new Set<string>()
  for (const [environmentId, entry] of state.runtimeStatusByEnvironmentId) {
    const hostId = toRuntimeExecutionHostId(environmentId)
    hostIds.add(hostId)
    reconnectAttention.observe(hostId, entry.status !== null, now)
  }
  for (const hostId of observedHostIds) {
    if (!hostIds.has(hostId)) {
      reconnectAttention.forget(hostId)
    }
  }
  observedHostIds = hostIds
}

export function ReconnectAttentionBridge(): null {
  useEffect(() => {
    observeReconnectAttention(useAppStore.getState(), Date.now())
    // Synchronous: the reconnect window opens before the replayed delivery asks whether to stay quiet.
    return useAppStore.subscribe((state, previous) => {
      if (state.runtimeStatusByEnvironmentId !== previous.runtimeStatusByEnvironmentId) {
        observeReconnectAttention(state, Date.now())
      }
    })
  }, [])
  return null
}
