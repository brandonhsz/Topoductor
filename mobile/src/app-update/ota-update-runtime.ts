import { useSyncExternalStore } from 'react'
import { hotUpdater } from './hot-updater-client'

export type OtaUpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'failed'

export type OtaUpdateState = {
  readonly phase: OtaUpdatePhase
  /** The deploy message (`-m`), shown with a downloaded update. */
  readonly message: string | null
}

type HotUpdaterClient = NonNullable<typeof hotUpdater>

let state: OtaUpdateState = { phase: 'idle', message: null }
let inFlight: Promise<OtaUpdatePhase> | null = null
const listeners = new Set<() => void>()

function setState(next: OtaUpdateState): void {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

async function downloadLatest(client: HotUpdaterClient): Promise<OtaUpdatePhase> {
  setState({ phase: 'checking', message: null })
  try {
    const update = await client.checkForUpdate({ updateStrategy: 'appVersion' })
    if (!update) {
      setState({ phase: 'up-to-date', message: null })
      return 'up-to-date'
    }
    setState({ phase: 'downloading', message: update.message })
    const downloaded = await update.updateBundle()
    const phase = downloaded ? 'ready' : 'failed'
    setState({ phase, message: update.message })
    return phase
  } catch {
    setState({ phase: 'failed', message: null })
    return 'failed'
  }
}

/** Checks the OTA server and downloads a newer bundle; 'ready' means a restart applies it. */
export function checkForOtaUpdate(): Promise<OtaUpdatePhase> {
  // Builds without OTA config have nothing to fetch, which is not a failure.
  if (!hotUpdater) {
    return Promise.resolve('up-to-date')
  }
  // A staged bundle stays staged until restart; checking again would only re-download it.
  if (state.phase === 'ready') {
    return Promise.resolve('ready')
  }
  inFlight ??= downloadLatest(hotUpdater).finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Reloads into the downloaded bundle. */
export function applyOtaUpdate(): void {
  void hotUpdater?.reload().catch(() => {})
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useOtaUpdateState(): OtaUpdateState {
  return useSyncExternalStore(subscribe, () => state)
}
