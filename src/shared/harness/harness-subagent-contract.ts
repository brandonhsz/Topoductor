import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { HarnessNodeRunner } from './harness-flow-types'
import type { HarnessChatTask, HarnessRun, HarnessStepStatus } from './harness-run-types'

export type HarnessSubagentMatch =
  | { task: HarnessChatTask }
  | { error: 'no_marker' | 'unknown_task' | 'prompt_mismatch' }

export type HarnessSubagentProgress = {
  /** Block and visit the agents belong to, e.g. «Bloque 1 · Mesa». */
  group: string
  done: number
  total: number
  agents: { title: string; status: HarnessStepStatus; output: string }[]
}

export type HarnessSubagentResult = { taskId: string | null; reason: string | null }

/** The runner a step really uses in a chat run: `subagent` falls back to `topo` when the chat cannot host it. */
export function resolveChatRunner(
  _node: { runner: HarnessNodeRunner; agent: TuiAgent | null },
  _chatProvider: TuiAgent | null
): HarnessNodeRunner {
  throw new Error('not implemented')
}

/** The exact prompt the chat must hand its subagent tool, marked with the task id. */
export function harnessSubagentPrompt(_taskId: string, _instructions: string): string {
  throw new Error('not implemented')
}

/** Finds the open subagent task a captured prompt belongs to; any wording change is a mismatch. */
export function matchSubagentPrompt(
  _prompt: string,
  _tasks: HarnessChatTask[]
): HarnessSubagentMatch {
  throw new Error('not implemented')
}

/** Progress of the subagent steps of the current block and visit; null when there are none. */
export function harnessSubagentProgress(_run: HarnessRun): HarnessSubagentProgress | null {
  throw new Error('not implemented')
}
