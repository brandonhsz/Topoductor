type TopoCloudSessionInvalidationListener = () => void

const listeners = new Set<TopoCloudSessionInvalidationListener>()

/** Auth-failure invalidation only; explicit sign-out returns fresh status directly. */
export function onTopoCloudSessionInvalidated(
  listener: TopoCloudSessionInvalidationListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitTopoCloudSessionInvalidated(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(
        '[topo-profiles] Cloud session invalidation listener failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
