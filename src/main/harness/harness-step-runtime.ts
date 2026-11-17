import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type {
  HarnessDecisionAnswer,
  HarnessPendingDecision,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'

export const RETRY = 'Reintentar'
export const SKIP = 'Omitir y seguir'
export const STOP = 'Detener'
export const CONTINUE = 'Continuar'

export class HarnessRunStopped extends Error {
  constructor() {
    super('Harness run stopped')
  }
}

export type AgentStepRequest = {
  nodeId: string
  taskId: string | null
  title: string
  block: string
  agent: TuiAgent | null
  instructions: string
  context: { key: string; value: string }[]
  choices: string[]
  /** Steps sharing a key continue one chat across visits; null always starts fresh. */
  sessionKey: string | null
}

export type AgentStepResult = { step: HarnessRunStep; output: string; outcome: string | null }

export type HarnessDecisionRequest = Omit<
  HarnessPendingDecision,
  'id' | 'stepId' | 'createdAt' | 'nodeId'
>

/** What node executors may do to a run; the engine owns scheduling and persistence. */
export type HarnessStepRuntime = {
  readonly run: HarnessRun
  addStep: (input: {
    nodeId: string
    taskId: string | null
    title: string
    agent: TuiAgent | null
    status: HarnessRunStep['status']
  }) => HarnessRunStep
  finishStep: (step: HarnessRunStep, patch: Partial<HarnessRunStep>) => void
  ask: (step: HarnessRunStep, decision: HarnessDecisionRequest) => Promise<HarnessDecisionAnswer>
  /** Null means the person chose to skip the failed step. */
  runAgentStep: (request: AgentStepRequest) => Promise<AgentStepResult | null>
  /** Stops the run; always throws so the caller unwinds. */
  stopRun: () => never
  touch: () => void
}
