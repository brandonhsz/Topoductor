import type { WslTopodConnection } from './wsl-topod-connection-types'
import type {
  Supervised,
  Trigger,
  WslTopodLivenessDependencies,
  WslTopodTimer
} from './wsl-topod-liveness-state'
import type { WslTopodWatch } from './wsl-topod-watch'

export function defaultSchedule(delayMs: number, task: () => void): WslTopodTimer {
  const timer = setTimeout(task, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** `onChange(false)` on a real resume only: subscribing reports the current state at once. */
export function subscribeWake(
  subscribePower: WslTopodLivenessDependencies['subscribePower'],
  onChange: (suspended: boolean) => void
): () => void {
  let subscribed = false
  const unsubscribe = subscribePower?.({
    onSuspend: () => onChange(true),
    onResume: () => {
      if (subscribed) {
        onChange(false)
      }
    }
  })
  subscribed = true
  return unsubscribe ?? (() => {})
}

/** A backoff wait that `disarm` ends early through `wakeWait`. */
export function cancellableWait(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslTopodTimer,
  delayMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    entry.wakeWait = resolve
    entry.timer = schedule(delayMs, resolve)
  }).finally(() => {
    entry.timer = null
    entry.wakeWait = null
  })
}

export async function ensureHolderQuietly(
  ensureHolder: WslTopodLivenessDependencies['ensureHolder'],
  distro: string
): Promise<void> {
  try {
    await ensureHolder?.(distro)
  } catch (error) {
    console.warn(`[wsl] holder re-ensure for ${distro} failed:`, error)
  }
}

/** A held watch that proves the port answers for it; a fresh one probes; a retired listener proves nothing. */
export async function probeTopodPort(
  entry: Supervised,
  connection: WslTopodConnection | null,
  attach: (connection: WslTopodConnection) => Promise<WslTopodWatch['signal']>
): Promise<WslTopodWatch['signal']> {
  if (!connection) {
    return 'refused'
  }
  return entry.watch?.proving() ? 'ready' : attach(connection)
}

/** While no watch proves topod (no desktop socket open), a full verify runs this often instead. */
export const WSL_TOPOD_IDLE_VERIFY_MS = 30_000

/** The next liveness tick: the heartbeat while a watch proves topod, a sooner full verify while none does. */
export function scheduleSupervisedHeartbeat(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslTopodTimer,
  now: () => number,
  heartbeatMs: number,
  trigger: (trigger: Trigger) => void
): void {
  entry.timer?.cancel()
  entry.lastBeatMs = now()
  const delayMs = entry.watch?.proving()
    ? heartbeatMs
    : Math.min(heartbeatMs, WSL_TOPOD_IDLE_VERIFY_MS)
  entry.timer = schedule(delayMs, () => {
    entry.timer = null
    // Long-overdue ticks imply process/VM suspension; reverify all evidence.
    const late = now() - entry.lastBeatMs > delayMs * 2
    trigger(late ? { source: 'verify' } : 'heartbeat')
  })
}

/** Holds a new watch unless a later connect superseded this one or already holds one. */
export async function attachSupervisedWatch(
  entry: Supervised,
  openWatch: () => Promise<WslTopodWatch>,
  onExit: (code: number | null) => void,
  onIdle: () => void = () => {}
): Promise<WslTopodWatch['signal']> {
  const generation = entry.generation
  const watch = await openWatch()
  if (watch.signal !== 'ready') {
    return watch.signal
  }
  if (entry.generation !== generation || entry.watch) {
    watch.close()
    return 'ready'
  }
  entry.watch = watch
  watch.onExit((code) => {
    if (entry.watch === watch) {
      entry.watch = null
      onExit(code)
    }
  })
  watch.onIdle?.(() => {
    if (entry.watch === watch) {
      onIdle()
    }
  })
  return 'ready'
}
