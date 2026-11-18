import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { HarnessFlow, HarnessNodeRunner, HarnessStartField } from './harness-flow-types'

export type HarnessRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export type HarnessStepStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export type HarnessAgentSessionRef =
  /** `tabless`: Topo started the chat without a tab; one opens when the person asks. */
  | { kind: 'structured'; worktreeId: string; sessionId: string; tabless?: true }
  | { kind: 'terminal'; worktreeId: string; paneKey: string | null; handle: string }

export type HarnessRunStep = {
  id: string
  nodeId: string
  /** Wave task id when the step runs one task of a waves node. */
  taskId: string | null
  title: string
  visit: number
  status: HarnessStepStatus
  agent: TuiAgent | null
  /** How the step actually ran after fallback; absent on runs saved before subagent steps. */
  runner?: HarnessNodeRunner | null
  session: HarnessAgentSessionRef | null
  output: string
  outcome: string | null
  error: string | null
  startedAt: number
  endedAt: number | null
}

export type HarnessDecisionReason = 'human' | 'restart' | 'outcome' | 'visit-limit' | 'wave-failed'

export type HarnessPendingDecision = {
  id: string
  stepId: string
  nodeId: string
  title: string
  reason: HarnessDecisionReason
  prompt: string
  context: { key: string; value: string }[]
  /** Empty means a free-text answer with a single Continue action. */
  choices: string[]
  /** Set when the decision re-asks the start node's fields. */
  fields: HarnessStartField[]
  createdAt: number
}

export type HarnessDecisionAnswer = {
  decisionId: string
  choice: string | null
  text: string
  fields: Record<string, string>
}

/** `chat`: the workspace chat drives the flow through `topo harness`; `orchestrated`: Topo launches every step. */
export type HarnessRunMode = 'chat' | 'orchestrated'

/** A step handed to the workspace chat; it stays open until the chat reports it with `topo harness completar`. */
export type HarnessChatTask = {
  id: string
  stepId: string
  nodeId: string
  taskId: string | null
  title: string
  /** The full prompt for this step, as Topo would send it to a fresh agent. */
  instructions: string
  choices: string[]
  allowEdits: boolean
  /** `subagent` tasks complete only through the capture hook; absent means `self`. */
  delivery?: HarnessChatTaskDelivery
  subagent?: HarnessChatSubagentTask | null
  createdAt: number
}

export type HarnessChatTaskDelivery = 'self' | 'subagent'

export type HarnessChatSubagentTask = {
  /** Shown as the subagent's description, e.g. «🧭 Agente Usabilidad». */
  label: string
  /** Exact prompt for the chat's subagent tool; first line is the `[topo-harness-task:<id>]` marker. */
  prompt: string
}

export type HarnessChatCompletion = {
  taskId: string
  output: string
  outcome: string | null
}

export type HarnessRun = {
  id: string
  mode: HarnessRunMode
  /** The chat that drives a chat-mode run; null until it is known. */
  chatSessionId: string | null
  chatTasks: HarnessChatTask[]
  flowId: string
  flowName: string
  /** The flow as it was when the run started; later edits never change a running graph. */
  flow: HarnessFlow
  worktreeId: string
  status: HarnessRunStatus
  vars: Record<string, string>
  steps: HarnessRunStep[]
  pending: HarnessPendingDecision[]
  error: string | null
  createdAt: number
  updatedAt: number
}

export type HarnessRunSummary = Pick<
  HarnessRun,
  'id' | 'flowId' | 'flowName' | 'worktreeId' | 'status' | 'createdAt' | 'updatedAt'
> & { pendingCount: number; mode: HarnessRunMode; chatSessionId?: string | null }

export type HarnessRunStartRequest = {
  flowId: string
  worktreeId: string
  fields: Record<string, string>
  mode: HarnessRunMode
  chatSessionId: string | null
}

export type HarnessApi = {
  listFlows: (repoId: string | null) => Promise<HarnessFlow[]>
  saveFlow: (flow: HarnessFlow) => Promise<HarnessFlow>
  deleteFlow: (flowId: string) => Promise<void>
  listRuns: () => Promise<HarnessRunSummary[]>
  getRun: (runId: string) => Promise<HarnessRun | null>
  startRun: (request: HarnessRunStartRequest) => Promise<HarnessRun>
  answerDecision: (runId: string, answer: HarnessDecisionAnswer) => Promise<void>
  stopRun: (runId: string) => Promise<void>
  deleteRun: (runId: string) => Promise<void>
  onFlowsChanged: (callback: () => void) => () => void
  onRunChanged: (callback: (run: HarnessRunSummary) => void) => () => void
}
