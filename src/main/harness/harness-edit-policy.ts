import type { HarnessRun } from '../../shared/harness/harness-run-types'

/**
 * Whether agents in a live run's workspace may edit files now. A step Topo runs itself counts
 * alongside the chat's open tasks; an orchestrated run waiting on nobody restricts nothing, while a
 * chat-driven run between tasks keeps its chat read-only.
 */
export function harnessRunAllowsEdits(run: HarnessRun): boolean {
  const running = run.steps.filter(
    (step) => step.status === 'running' && step.allowEdits !== undefined
  )
  if (run.chatTasks.some((task) => task.allowEdits) || running.some((step) => step.allowEdits)) {
    return true
  }
  return run.mode === 'orchestrated' && running.length === 0
}
