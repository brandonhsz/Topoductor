import { TOPO_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import type { TopoRuntimeService } from '../runtime/topo-runtime'
import type { TopodFeatureReadiness } from '../runtime/rpc/topod-feature-readiness'
import { placeUnshownLiveTerminalsBestEffort } from '../runtime/terminal/adoption/unshown-live-terminal-placement'
import type { createTopodStartupTiming } from './topod-startup-timing'

/** Restored orchestration authority, the legacy terminal reconcile and unshown placement, in order. */
export async function restoreTopodTerminalAuthority(
  runtime: TopoRuntimeService,
  timed: ReturnType<typeof createTopodStartupTiming>['time'],
  readiness: TopodFeatureReadiness
): Promise<void> {
  await timed('orchestration', () => runtime.refreshRestoredOrchestrationAuthority())
  readiness.open('orchestration')
  // Terminal inventory stays on the critical path: no latch, every client needs it at connect.
  await timed('reconcile-terminals', () => runtime.reconcileLegacyWorkerTerminals())
  if (TOPO_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  readiness.open('unshownPlacement')
}
