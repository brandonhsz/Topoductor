import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { HarnessContextEntry } from '../../shared/harness/harness-agent-prompt'
import type { HarnessNode, HarnessNodeRunner } from '../../shared/harness/harness-flow-types'
import type { HarnessSubagentResult } from '../../shared/harness/harness-subagent-contract'
import type {
  HarnessChatCompletion,
  HarnessChatTask,
  HarnessDecisionAnswer,
  HarnessPendingDecision,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'

export const RETRY = 'Reintentar'
export const SKIP = 'Omitir y seguir'
export const STOP = 'Detener'
export const CONTINUE = 'Continuar'
export const BACK_TO_PLAN = 'Volver al plan'

export class HarnessRunStopped extends Error {
  constructor() {
    super('Harness run stopped')
  }
}

/** Thrown by an executor to leave its node for `nodeId` instead of following its edges. */
export class HarnessRedirect extends Error {
  constructor(readonly nodeId: string) {
    super(`Harness redirect to ${nodeId}`)
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
  /** Who runs the step in a chat-driven run; orchestrated runs always launch an agent. */
  runner: HarnessNodeRunner
  allowEdits: boolean
}

export type HarnessChatTaskRequest = Pick<
  HarnessChatTask,
  'nodeId' | 'taskId' | 'title' | 'instructions' | 'choices' | 'allowEdits'
> & {
  /** `subagent` tasks carry `instructions` as the subagent's prompt and complete only by capture. */
  delivery?: 'self' | 'subagent'
}

export type { HarnessSubagentResult }

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
    runner?: HarnessNodeRunner
  }) => HarnessRunStep
  finishStep: (step: HarnessRunStep, patch: Partial<HarnessRunStep>) => void
  writeVar: (key: string, value: string) => void
  /** The node's inputs as context, minus `freshInputs` it already received unchanged. */
  inputContext: (node: Extract<HarnessNode, { inputs: string[] }>) => HarnessContextEntry[]
  ask: (step: HarnessRunStep, decision: HarnessDecisionRequest) => Promise<HarnessDecisionAnswer>
  /** Agent of the chat that drives a chat-mode run; null when unknown or not a chat. */
  chatProvider: () => Promise<TuiAgent | null>
  /** Hands a step to the workspace chat and resolves when the chat reports it. */
  awaitChat: (step: HarnessRunStep, task: HarnessChatTaskRequest) => Promise<HarnessChatCompletion>
  /** Null means the person chose to skip the failed step. */
  runAgentStep: (request: AgentStepRequest) => Promise<AgentStepResult | null>
  /** Stops the run; always throws so the caller unwinds. */
  stopRun: () => never
  touch: () => void
}
