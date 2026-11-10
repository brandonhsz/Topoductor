import type { Store } from '../persistence/loading-store/store'
import type { TopoRuntimeService } from '../runtime/topo-runtime'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { isFinalAutomationRunStatus } from '../../shared/automations/history/automation-run'

type AutomationStore = Pick<Store, 'listAutomations' | 'listAutomationRuns'>

let stopScheduler: (() => void) | null = null

export function startTopodAutomations(
  runtime: TopoRuntimeService,
  store: Store,
  registerCleanup: (cleanup: () => void) => void
): void {
  const service = createRuntimeAutomationService({
    store,
    runtime,
    allowRemoteHostScheduling: true
  })
  stopScheduler = () => service.stop()
  // Stop before final profile flush so runs cannot persist afterward.
  registerCleanup(() => service.stop())
  service.start()
}

export function stopTopodAutomationScheduler(): void {
  stopScheduler?.()
}

/** Pending schedules/runs must keep the host alive. */
export function topodAutomationsKeepHostBusy(store: AutomationStore): boolean {
  return (
    store.listAutomations().some((automation) => automation.enabled) ||
    store.listAutomationRuns().some((run) => !isFinalAutomationRunStatus(run.status))
  )
}
