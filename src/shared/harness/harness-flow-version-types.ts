import type { HarnessFlow } from './harness-flow-types'

export type HarnessFlowAuthor = 'person' | 'agent'

export const HARNESS_FLOW_VERSION_SUMMARY_MAX = 500

/** Immutable snapshot of a flow; restoring one never deletes later versions. */
export type HarnessFlowVersion = {
  id: string
  flowId: string
  createdAt: number
  author: HarnessFlowAuthor
  summary: string
  flow: HarnessFlow
}

export type HarnessFlowVersionSummary = Omit<HarnessFlowVersion, 'flow'>

/** Payload of `harness:flowsChanged`. */
export type HarnessFlowChange = {
  flowId: string
  kind: 'saved' | 'deleted' | 'restored'
  source: HarnessFlowAuthor
  summary: string
  /** Null once the flow is deleted. */
  updatedAt: number | null
}

/** What an agent gets when it reads a flow. */
export type HarnessFlowReading = {
  flow: HarnessFlow
  markdown: string
  problems: string[]
  /** Running or waiting runs of this flow; they keep the copy they started with. */
  activeRuns: number
  /** A global flow reaches every repo without its own copy. */
  affectsAllRepos: boolean
}

export type HarnessFlowListItem = Pick<
  HarnessFlow,
  'id' | 'name' | 'description' | 'scope' | 'basedOnFlowId' | 'updatedAt'
> & { nodeCount: number }

export type HarnessFlowSaveResult = {
  reading: HarnessFlowReading
  version: HarnessFlowVersionSummary
}
