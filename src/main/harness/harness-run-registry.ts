import type {
  HarnessChatCompletion,
  HarnessDecisionAnswer,
  HarnessRun
} from '../../shared/harness/harness-run-types'

type HarnessCaller = { sessionId: string | null; worktreeId: string | null }

/** What RPC methods, hooks and launches need from the run service, without importing the engine. */
export type HarnessChatRuns = {
  findChatRun: (caller: HarnessCaller) => Promise<HarnessRun | null>
  bindChatSession: (runId: string, sessionId: string) => void
  completeChat: (runId: string, completion: HarnessChatCompletion) => boolean
  waitForChange: (runId: string, timeoutMs: number) => Promise<HarnessRun | null>
  answer: (runId: string, answer: HarnessDecisionAnswer) => void
  editsAllowed: (caller: HarnessCaller) => boolean
  chatInstructions: (worktreeId: string, sessionId: string) => string | null
}

let service: HarnessChatRuns | null = null

/** RPC methods run outside the IPC registration that owns the service; they reach it here. */
export function setHarnessRunService(next: HarnessChatRuns): void {
  service = next
}

export function getHarnessRunService(): HarnessChatRuns | null {
  return service
}
