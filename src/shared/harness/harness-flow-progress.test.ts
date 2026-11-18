import { describe, expect, it } from 'vitest'
import type { HarnessPendingDecision, HarnessRun, HarnessRunStep } from './harness-run-types'
import { IDEATION_NODES } from './harness-example-flow-ideation'
import { DELIVERY_NODES } from './harness-example-flow-delivery'
import { EMPTY_HARNESS_PROJECT } from './harness-flow-normalize'
import type { HarnessFlow } from './harness-flow-types'
import { harnessFlowProgress } from './harness-flow-progress'

let counter = 0
function step(nodeId: string, patch: Partial<HarnessRunStep>): HarnessRunStep {
  return {
    id: `${nodeId}-${++counter}`,
    nodeId,
    taskId: null,
    title: nodeId,
    visit: 1,
    status: 'running',
    agent: null,
    runner: 'subagent',
    session: null,
    output: '',
    outcome: null,
    error: null,
    startedAt: 0,
    endedAt: null,
    ...patch
  }
}

function runWith(steps: HarnessRunStep[], pending: HarnessPendingDecision[] = []): HarnessRun {
  const flow: HarnessFlow = {
    schemaVersion: 1,
    id: 'f',
    name: 'Ideación',
    description: '',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: '',
    project: EMPTY_HARNESS_PROJECT,
    nodes: [...IDEATION_NODES, ...DELIVERY_NODES],
    edges: [],
    updatedAt: 0
  }
  return {
    id: 'r',
    mode: 'chat',
    chatSessionId: 's',
    chatTasks: [],
    flowId: flow.id,
    flowName: flow.name,
    flow,
    worktreeId: 'wt',
    status: 'running',
    vars: {},
    steps,
    pending,
    error: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function decision(stepId: string, choices: string[]): HarnessPendingDecision {
  return {
    id: `d-${stepId}`,
    stepId,
    nodeId: 'ejecucion',
    title: 'Cierre oleada 1',
    reason: 'human',
    prompt: 'El agente falló',
    context: [],
    choices,
    fields: [],
    createdAt: 0
  }
}

const hidden = (sessionId: string) =>
  ({ kind: 'structured', worktreeId: 'wt', sessionId, tabless: true }) as const

describe('harnessFlowProgress', () => {
  it('is null while the run has no subagent or Topo agent', () => {
    expect(harnessFlowProgress(runWith([step('idea', { runner: 'chat' })]))).toBeNull()
  })

  it('counts the latest visit of a subagent block', () => {
    const progress = harnessFlowProgress(
      runWith([
        step('usabilidad', { status: 'done', output: 'vieja' }),
        step('usabilidad', { visit: 2, status: 'done', output: 'U2' }),
        step('ingeniero', { visit: 2, status: 'done', output: 'I2' }),
        step('viabilidad', { visit: 2, status: 'running' })
      ])
    )
    expect(progress!.rows).toHaveLength(1)
    expect(progress!.rows[0]).toMatchObject({
      kind: 'subagents',
      group: 'Bloque 1 · Mesa',
      done: 2,
      total: 3
    })
    const latest = progress!.rows[0]!
    expect(
      latest.kind === 'subagents' && latest.agents.map((agent) => [agent.status, agent.output])
    ).toEqual([
      ['done', 'U2'],
      ['done', 'I2'],
      ['running', '']
    ])
  })

  it('lists subagent blocks and Topo agents in run order under the flow and current block', () => {
    const progress = harnessFlowProgress(
      runWith([
        step('usabilidad', { status: 'done' }),
        step('idea', { runner: 'chat', status: 'done' }),
        step('ejecucion', {
          taskId: 'oleada-1',
          title: 'Cierre oleada 1',
          runner: 'topo',
          agent: 'codex',
          status: 'done',
          outcome: 'ok',
          session: hidden('a1')
        }),
        step('ejecucion', {
          taskId: 'oleada-2',
          title: 'Cierre oleada 2',
          runner: 'topo',
          agent: 'codex',
          startedAt: 10,
          session: hidden('a2')
        })
      ])
    )
    expect(progress).toMatchObject({ flowName: 'Ideación', block: 'Bloque 2', tabless: 2 })
    expect(progress!.attention).toBe(0)
    expect(progress!.rows.map((row) => (row.kind === 'agent' ? row.title : row.group))).toEqual([
      'Bloque 1 · Mesa',
      'Cierre oleada 1',
      'Cierre oleada 2'
    ])
    expect(progress!.rows[2]).toMatchObject({
      kind: 'agent',
      status: 'running',
      agent: 'codex',
      startedAt: 10,
      session: hidden('a2'),
      attention: false,
      decision: null
    })
  })

  it('keeps only the latest attempt of a retried agent', () => {
    const progress = harnessFlowProgress(
      runWith([
        step('juez', { runner: 'topo', status: 'failed', error: 'x' }),
        step('juez', { runner: 'topo', status: 'running' })
      ])
    )
    expect(progress!.rows).toHaveLength(1)
    expect(progress!.rows[0]).toMatchObject({ kind: 'agent', status: 'running' })
  })

  it('flags an agent waiting on the person through its decision or its chat', () => {
    const failed = step('juez', { runner: 'topo', status: 'failed', session: hidden('j') })
    const asking = step('revisor', { runner: 'topo', session: hidden('r') })
    const progress = harnessFlowProgress(
      runWith([failed, asking], [decision(failed.id, ['Reintentar', 'Omitir y seguir'])]),
      (sessionId) => ({ attention: sessionId === 'r', activity: 'Bash: pnpm test' })
    )
    expect(progress!.attention).toBe(2)
    expect(progress!.rows[0]).toMatchObject({
      attention: true,
      decision: { id: `d-${failed.id}`, choices: ['Reintentar', 'Omitir y seguir'] }
    })
    expect(progress!.rows[1]).toMatchObject({
      attention: true,
      decision: null,
      activity: 'Bash: pnpm test'
    })
  })
})
