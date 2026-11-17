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

// Only Claude reports a subagent's exact prompt and final text to a PostToolUse hook.
const SUBAGENT_HOSTS: ReadonlySet<TuiAgent> = new Set(['claude', 'claude-agent-teams'])

const MARKER = /\[topo-harness-task:([^\]\s]+)\]/

/** The runner a step really uses in a chat run: `subagent` falls back to `topo` when the chat cannot host it. */
export function resolveChatRunner(
  node: { runner: HarnessNodeRunner; agent: TuiAgent | null },
  chatProvider: TuiAgent | null
): HarnessNodeRunner {
  if (node.runner !== 'subagent') {
    return node.runner
  }
  const hosted = chatProvider !== null && SUBAGENT_HOSTS.has(chatProvider)
  return hosted && (node.agent === null || node.agent === chatProvider) ? 'subagent' : 'topo'
}

/** The exact prompt the chat must hand its subagent tool, marked with the task id. */
export function harnessSubagentPrompt(taskId: string, instructions: string): string {
  return `[topo-harness-task:${taskId}]\n${instructions}`
}

function comparable(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Finds the open subagent task a captured prompt belongs to; any wording change is a mismatch. */
export function matchSubagentPrompt(
  prompt: string,
  tasks: HarnessChatTask[]
): HarnessSubagentMatch {
  const taskId = MARKER.exec(prompt)?.[1]
  if (!taskId) {
    return { error: 'no_marker' }
  }
  const task = tasks.find((entry) => entry.id === taskId && entry.delivery === 'subagent')
  if (!task?.subagent) {
    return { error: 'unknown_task' }
  }
  return comparable(prompt) === comparable(task.subagent.prompt)
    ? { task }
    : { error: 'prompt_mismatch' }
}

/** Progress of the subagent steps of the current block and visit; null when there are none. */
export function harnessSubagentProgress(run: HarnessRun): HarnessSubagentProgress | null {
  const blockOf = (nodeId: string): string =>
    run.flow.nodes.find((node) => node.id === nodeId)?.block ?? ''
  const subagentSteps = run.steps.filter((step) => step.runner === 'subagent')
  const latest = subagentSteps.at(-1)
  if (!latest) {
    return null
  }
  const group = blockOf(latest.nodeId)
  const current = subagentSteps.filter(
    (step) => step.visit === latest.visit && blockOf(step.nodeId) === group
  )
  return {
    group,
    done: current.filter((step) => step.status === 'done').length,
    total: current.length,
    agents: current.map(({ title, status, output }) => ({ title, status, output }))
  }
}
