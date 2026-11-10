import type { TopodManagedStopRequest } from '../../shared/topod-stop-request'
import { persistTopodDaemonRetirementRecord } from './topod-completed-stop-receipt'
import type { TopodDaemonRetirement } from './topod-daemon-retirement'
import { stopTopodAutomationScheduler } from './topod-automations'
import { holdTopodTerminalAdmissionUntilExit } from './topod-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<TopodDaemonRetirement> {
  const { retireTopodDaemonIfIdle } = await import('./topod-daemon-retirement')
  return retireTopodDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareTopodManagedStop(
  request: TopodManagedStopRequest,
  retire: () => Promise<TopodDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopTopodAutomationScheduler,
  holdTerminalAdmission: () => void = holdTopodTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): TopodDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistTopodDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[topod] could not record daemon retirement:', error)
  }
}
