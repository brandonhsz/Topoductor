import type { TuiAgent } from '../agent-launch/catalog/tui-agent'

export const HARNESS_FLOW_SCHEMA_VERSION = 1

export type HarnessNodeKind = 'start' | 'agent' | 'human' | 'waves' | 'end'

export type HarnessNodeRunner = 'chat' | 'topo'

export type HarnessStartField = {
  key: string
  label: string
  /** Empty means free text; otherwise the run form shows a select. */
  options: string[]
  /** Optional fields may be left empty when starting a run. */
  optional: boolean
}

export type HarnessPosition = { x: number; y: number }

/** Shared by every node that does work and can loop. */
type HarnessStepFields = {
  /** Variables whose latest value is handed to the step as context. */
  inputs: string[]
  /** Variable that stores the step's final answer. */
  outputKey: string
  /** True waits for every upstream node that ran in this pass before starting. */
  joinAll: boolean
  /** Visits allowed per run before the loop stops. */
  maxVisits: number
  /** Node that runs instead once `maxVisits` is reached; null asks the person. */
  limitTarget: string | null
}

type HarnessNodeBase = {
  id: string
  title: string
  /** Free-form stage label ("Bloque 1") shown as a chip on the node. */
  block: string
  position: HarnessPosition
}

export type HarnessStartNode = HarnessNodeBase & {
  kind: 'start'
  fields: HarnessStartField[]
}

export type HarnessAgentNode = HarnessNodeBase & {
  kind: 'agent'
  /** Null runs the flow's default agent. */
  agent: TuiAgent | null
  prompt: string
  /** Later visits continue the same chat, so the agent keeps what it learned. */
  reuseSession: boolean
  /** In chat-driven runs, `topo` launches its own agent (multi-model, fresh eyes); `chat` hands the step to the workspace chat. */
  runner: HarnessNodeRunner
  /** False blocks file edits while this step is the chat's current task. */
  allowEdits: boolean
} & HarnessStepFields

export type HarnessHumanNode = HarnessNodeBase & {
  kind: 'human'
  prompt: string
} & HarnessStepFields

export type HarnessWaveRole = {
  name: string
  agent: TuiAgent | null
  prompt: string
  /** Folders or globs this role owns; empty leaves the layer to the plan. */
  paths: string[]
}

/** Runs a task plan (JSON from `planKey`) wave by wave, tasks of a wave in parallel. */
export type HarnessWavesNode = HarnessNodeBase & {
  kind: 'waves'
  planKey: string
  roles: HarnessWaveRole[]
  /** Shell command run after each wave; empty skips verification. */
  verifyCommand: string
  /** Commits the workspace after each wave so later steps can compare or roll back. */
  checkpointEachWave: boolean
  /** In chat-driven runs, `chat` hands the wave tasks to the workspace chat. */
  runner: HarnessNodeRunner
  allowEdits: boolean
} & HarnessStepFields

export type HarnessEndNode = HarnessNodeBase & {
  kind: 'end'
}

export type HarnessNode =
  | HarnessStartNode
  | HarnessAgentNode
  | HarnessHumanNode
  | HarnessWavesNode
  | HarnessEndNode

export type HarnessEdgeCondition = { key: string; op: 'eq' | 'neq'; value: string }

export type HarnessEdge = {
  id: string
  source: string
  target: string
  /** Empty label always fires; labeled siblings are mutually exclusive outcomes. */
  label: string
  /** Also requires a run variable to match, e.g. `tipo = bug`. */
  when: HarnessEdgeCondition | null
}

export type HarnessPrMode = 'single' | 'stacked'

/** What only the repository knows; a repo override fills it so prompts stay generic. */
export type HarnessProjectProfile = {
  /** How to start the app for evidence, e.g. `pnpm dev`. */
  appCommand: string
  appUrl: string
  /** Default verification after each wave when the waves node sets none. */
  testCommand: string
  /** How evidence (screenshots, videos) is captured in this repo. */
  evidenceTool: string
  /** Repo rules every agent should follow. */
  notes: string
  /** `stacked` opens one PR per wave, each on top of the previous one. */
  prMode: HarnessPrMode
}

export type HarnessFlowScope = { kind: 'global' } | { kind: 'repo'; repoId: string }

export type HarnessFlow = {
  schemaVersion: number
  id: string
  name: string
  description: string
  scope: HarnessFlowScope
  /** Global flow this repo override was copied from. */
  basedOnFlowId: string | null
  defaultAgent: TuiAgent
  /** Rules prepended to every agent launched by this flow. */
  sharedInstructions: string
  project: HarnessProjectProfile
  nodes: HarnessNode[]
  edges: HarnessEdge[]
  updatedAt: number
}
