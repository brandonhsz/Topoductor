import type { BrowserWindow } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { TopoRuntimeService } from '../../runtime/topo-runtime'
import type { RuntimeWorktreeLifecycleEvent } from '../../runtime/workspaces/lifecycle/worktree-lifecycle-event'
import type { SenderScopedRequestCancellations } from '../sender-scoped-request-cancellation'
import type { WorktreeRemovalInFlight } from './removal/worktree-removal-coordinator'

export type WorktreeIpcContext = {
  mainWindow: BrowserWindow
  store: Store
  runtime: TopoRuntimeService
  options?: {
    onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void
  }
  detectedWorktreeCancellations: SenderScopedRequestCancellations
  worktreeRemovalsInFlight: Map<string, WorktreeRemovalInFlight>
}

// Removal/forget ref deletes use packed-refs locks; idle maintenance needs this process-wide registry to avoid racing them.
let activeWorktreeRemovals: ReadonlyMap<string, WorktreeRemovalInFlight> | null = null

export function createWorktreeRemovalRegistry(): Map<string, WorktreeRemovalInFlight> {
  const registry = new Map<string, WorktreeRemovalInFlight>()
  activeWorktreeRemovals = registry
  return registry
}

export function hasWorktreeRemovalsInFlight(): boolean {
  return (activeWorktreeRemovals?.size ?? 0) > 0
}
