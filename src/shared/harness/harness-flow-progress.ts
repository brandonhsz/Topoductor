import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { HarnessAgentSessionRef, HarnessRun, HarnessStepStatus } from './harness-run-types'

export type HarnessFlowProgressSubagents = {
  kind: 'subagents'
  key: string
  /** Block the agents belong to, e.g. «Bloque 1 · Mesa». */
  group: string
  done: number
  total: number
  agents: { id: string; title: string; status: HarnessStepStatus; output: string }[]
}

/** An agent Topo runs itself, in its own session the person opens on demand. */
export type HarnessFlowProgressAgent = {
  kind: 'agent'
  key: string
  stepId: string
  title: string
  status: HarnessStepStatus
  outcome: string | null
  agent: TuiAgent | null
  session: HarnessAgentSessionRef | null
  startedAt: number
  /** What the agent is doing now, when its session reports it. */
  activity: string | null
  /** The agent waits on the person: a pending decision or a question in its chat. */
  attention: boolean
  decision: { id: string; choices: string[] } | null
}

export type HarnessFlowProgressRow = HarnessFlowProgressSubagents | HarnessFlowProgressAgent

export type HarnessFlowProgress = {
  flowName: string
  /** Block of the newest step. */
  block: string
  rows: HarnessFlowProgressRow[]
  /** Agents Topo started without a tab. */
  tabless: number
  /** Agents waiting on the person. */
  attention: number
}

export type HarnessSessionLiveStatus = { attention: boolean; activity: string | null }

/** The run's subagent blocks and Topo agents in run order; null when it has neither. */
export function harnessFlowProgress(
  run: HarnessRun,
  liveStatus: (sessionId: string) => HarnessSessionLiveStatus | null = () => null
): HarnessFlowProgress | null {
  const blockOf = (nodeId: string): string =>
    run.flow.nodes.find((node) => node.id === nodeId)?.block ?? ''
  const rows = new Map<string, HarnessFlowProgressRow>()
  for (const step of run.steps) {
    if (step.runner === 'subagent') {
      const group = blockOf(step.nodeId)
      const key = `subagents:${group}:${step.visit}`
      // A later visit of the block replaces the earlier one.
      for (const existing of rows.values()) {
        if (existing.kind === 'subagents' && existing.group === group && existing.key !== key) {
          rows.delete(existing.key)
        }
      }
      const row = rows.get(key)
      const agent = { id: step.id, title: step.title, status: step.status, output: step.output }
      if (row?.kind === 'subagents') {
        row.agents.push(agent)
      } else {
        rows.set(key, { kind: 'subagents', key, group, done: 0, total: 0, agents: [agent] })
      }
      continue
    }
    if (step.runner !== 'topo') {
      continue
    }
    // A retry replaces the failed attempt it follows.
    const key = `agent:${step.nodeId}:${step.taskId ?? ''}:${step.visit}`
    const decision = run.pending.find((entry) => entry.stepId === step.id) ?? null
    const live =
      step.session?.kind === 'structured' && step.status === 'running'
        ? liveStatus(step.session.sessionId)
        : null
    const row: HarnessFlowProgressAgent = {
      kind: 'agent',
      key,
      stepId: step.id,
      title: step.title,
      status: step.status,
      outcome: step.outcome,
      agent: step.agent,
      session: step.session,
      startedAt: step.startedAt,
      activity: live?.activity ?? null,
      attention: decision !== null || live?.attention === true,
      decision: decision ? { id: decision.id, choices: decision.choices } : null
    }
    rows.delete(key)
    rows.set(key, row)
  }
  if (rows.size === 0) {
    return null
  }
  const list = [...rows.values()]
  for (const row of list) {
    if (row.kind === 'subagents') {
      row.total = row.agents.length
      row.done = row.agents.filter((agent) => agent.status === 'done').length
    }
  }
  const agents = list.filter((row) => row.kind === 'agent')
  return {
    flowName: run.flowName,
    block: blockOf(run.steps.at(-1)?.nodeId ?? ''),
    rows: list,
    tabless: agents.filter((row) => row.session?.kind === 'structured' && row.session.tabless)
      .length,
    attention: agents.filter((row) => row.attention).length
  }
}
