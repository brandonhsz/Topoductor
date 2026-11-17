import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { HarnessFlow, HarnessStartField } from './harness-flow-types'

export type HarnessRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export type HarnessStepStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export type HarnessAgentSessionRef =
  | { kind: 'structured'; worktreeId: string; sessionId: string }
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

export type HarnessRun = {
  id: string
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
> & { pendingCount: number }

export type HarnessRunStartRequest = {
  flowId: string
  worktreeId: string
  fields: Record<string, string>
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
