type TargetTeardownListener = (targetId: string) => Promise<void>
type ShutdownListener = () => Promise<void>

// Features owning per-target transports subscribe here so teardown never lazy-loads them.
const targetTeardownListeners = new Set<TargetTeardownListener>()
const shutdownListeners = new Set<ShutdownListener>()

export function onSshTargetTeardown(listener: TargetTeardownListener): () => void {
  targetTeardownListeners.add(listener)
  return () => targetTeardownListeners.delete(listener)
}

export function onSshShutdown(listener: ShutdownListener): () => void {
  shutdownListeners.add(listener)
  return () => shutdownListeners.delete(listener)
}

export async function runSshTargetTeardownListeners(targetId: string): Promise<void> {
  await Promise.all([...targetTeardownListeners].map((listener) => listener(targetId)))
}

export async function runSshShutdownListeners(): Promise<void> {
  await Promise.all([...shutdownListeners].map((listener) => listener()))
}
