import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { AvenaPMConnectionStatus } from '../../../../../shared/avenapm/avenapm-types'

type AvenaPMConnectionState = {
  status: AvenaPMConnectionStatus | null
  connecting: boolean
  error: string | null
}

const connectionStore = createStore<AvenaPMConnectionState>(() => ({
  status: null,
  connecting: false,
  error: null
}))

let statusRequest: Promise<void> | null = null

export function refreshAvenaPMStatus(): Promise<void> {
  statusRequest ??= window.api.avenapm
    .status()
    .then((status) => connectionStore.setState({ status }))
    .catch((error: unknown) =>
      connectionStore.setState({ error: error instanceof Error ? error.message : String(error) })
    )
    .finally(() => {
      statusRequest = null
    })
  return statusRequest
}

export async function connectAvenaPM(): Promise<boolean> {
  connectionStore.setState({ connecting: true, error: null })
  try {
    const status = await window.api.avenapm.connect()
    connectionStore.setState({ status, connecting: false })
    return status.connected
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Cancelling the browser sign-in is a user choice, not an error to surface.
    connectionStore.setState({
      connecting: false,
      error: message.includes('avenapm_auth_cancelled') ? null : message
    })
    return false
  }
}

export function cancelAvenaPMConnect(): void {
  void window.api.avenapm.cancelConnect()
}

export async function disconnectAvenaPM(): Promise<void> {
  const status = await window.api.avenapm.disconnect()
  connectionStore.setState({ status, error: null })
}

export function markAvenaPMDisconnected(): void {
  const current = connectionStore.getState().status
  if (current?.connected) {
    connectionStore.setState({ status: { connected: false, baseUrl: current.baseUrl } })
  }
}

export function useAvenaPMConnection(): AvenaPMConnectionState {
  return useStore(connectionStore, (state) => state)
}
