import { describe, expect, it } from 'vitest'
import type {
  HarnessAgentNode,
  HarnessEdge,
  HarnessEdgeCondition,
  HarnessFlow,
  HarnessNode
} from '../../shared/harness/harness-flow-types'
import { EMPTY_HARNESS_PROJECT } from '../../shared/harness/harness-flow-normalize'
import type { HarnessRun } from '../../shared/harness/harness-run-types'
import type { HarnessAgentLauncher } from './harness-agent-launcher'
import { HarnessRunEngine } from './harness-run-engine'

const at = { x: 0, y: 0 }

function agent(id: string, extra: Partial<HarnessAgentNode> = {}): HarnessAgentNode {
  return {
    kind: 'agent',
    id,
    title: id,
    block: '',
    position: at,
    agent: null,
    prompt: `TAREA:${id}`,
    reuseSession: false,
    runner: 'topo',
    allowEdits: true,
    inputs: ['intent'],
    outputKey: id,
    joinAll: false,
    maxVisits: 5,
    limitTarget: null,
    ...extra
  }
}

function edge(
  source: string,
  target: string,
  label = '',
  when: HarnessEdgeCondition | null = null
): HarnessEdge {
  return { id: `${source}-${target}-${label}`, source, target, label, when }
}

function flowOf(nodes: HarnessNode[], edges: HarnessEdge[]): HarnessFlow {
  return {
    schemaVersion: 1,
    id: 'f',
    name: 'Prueba',
    description: '',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: '',
    project: EMPTY_HARNESS_PROJECT,
    nodes: [
      { kind: 'start', id: 'start', title: 'Inicio', block: '', position: at, fields: [] },
      { kind: 'end', id: 'fin', title: 'Fin', block: '', position: at },
      ...nodes
    ],
    edges,
    updatedAt: 0
  }
}

function runOf(flow: HarnessFlow, vars: Record<string, string>): HarnessRun {
  return {
    id: 'run',
    mode: 'orchestrated',
    chatSessionId: null,
    chatTasks: [],
    flowId: flow.id,
    flowName: flow.name,
    flow,
    worktreeId: 'wt',
    status: 'running',
    vars,
    steps: [],
    pending: [],
    error: null,
    createdAt: 0,
    updatedAt: 0
  }
}

/** Each launched node waits until the test answers it by node id. */
function controlledLauncher(): {
  launch: HarnessAgentLauncher
  replies: Map<string, (text: string) => void>
  prompts: string[]
} {
  const replies = new Map<string, (text: string) => void>()
  const prompts: string[] = []
  const launch: HarnessAgentLauncher = (request) => {
    prompts.push(request.prompt)
    const node = /TAREA:(\w+)/.exec(request.prompt)![1]!
    return new Promise((resolve) => replies.set(node, (text) => resolve({ ok: true, text })))
  }
  return { launch, replies, prompts }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

describe('HarnessRunEngine', () => {
  it('fans out, joins, waits for the person and follows the chosen outcome', async () => {
    const flow = flowOf(
      [
        agent('a'),
        agent('b'),
        agent('sintesis', { inputs: ['a', 'b'], joinAll: true }),
        {
          kind: 'human',
          id: 'respuesta',
          title: 'Respuesta',
          block: '',
          position: at,
          prompt: 'Decide',
          inputs: ['sintesis'],
          outputKey: 'respuesta',
          joinAll: false,
          maxVisits: 5,
          limitTarget: null
        }
      ],
      [
        edge('start', 'a'),
        edge('start', 'b'),
        edge('a', 'sintesis'),
        edge('b', 'sintesis'),
        edge('sintesis', 'respuesta'),
        edge('respuesta', 'a', 'Otra ronda'),
        edge('respuesta', 'fin', 'Consolidada')
      ]
    )
    const { launch, replies, prompts } = controlledLauncher()
    const run = runOf(flow, { intent: 'Ayudar al equipo' })
    const engine = new HarnessRunEngine(run, { launch, onChange: () => {} })
    engine.start()
    await settle()
    expect([...replies.keys()].sort()).toEqual(['a', 'b'])

    replies.get('a')!('respuesta de A')
    await settle()
    expect(replies.has('sintesis')).toBe(false)

    replies.get('b')!('respuesta de B')
    await settle()
    expect(prompts.at(-1)).toContain('### a\nrespuesta de A')
    expect(prompts.at(-1)).toContain('### b\nrespuesta de B')

    replies.get('sintesis')!('Ronda 1')
    await settle()
    expect(run.status).toBe('waiting')
    expect(run.pending[0]!.choices).toEqual(['Otra ronda', 'Consolidada'])

    engine.answer({
      decisionId: run.pending[0]!.id,
      choice: 'Consolidada',
      text: 'listo',
      fields: {}
    })
    await settle()
    expect(run.status).toBe('completed')
    expect(run.vars.respuesta).toBe('Decisión: Consolidada\n\nlisto')
    expect(run.steps.map((step) => step.nodeId)).toEqual([
      'start',
      'a',
      'b',
      'sintesis',
      'respuesta',
      'fin'
    ])
  })

  it('routes by run variables and sends a looping node to its limit target', async () => {
    const flow = flowOf(
      [
        agent('reproducir'),
        agent('corregir', { maxVisits: 2, limitTarget: 'escalar' }),
        agent('escalar')
      ],
      [
        edge('start', 'reproducir', '', { key: 'tipo', op: 'eq', value: 'bug' }),
        edge('start', 'corregir', '', { key: 'tipo', op: 'neq', value: 'bug' }),
        edge('corregir', 'corregir', 'Otro intento'),
        edge('corregir', 'fin', 'Resuelto'),
        edge('escalar', 'fin')
      ]
    )
    const { launch, replies } = controlledLauncher()
    const run = runOf(flow, { intent: 'Arreglar', tipo: 'Feature' })
    new HarnessRunEngine(run, { launch, onChange: () => {} }).start()
    await settle()
    expect([...replies.keys()]).toEqual(['corregir'])

    replies.get('corregir')!('SALIDA: Otro intento')
    await settle()
    replies.get('corregir')!('SALIDA: Otro intento')
    await settle()
    replies.get('escalar')!('escalado')
    await settle()

    expect(run.status).toBe('completed')
    expect(run.steps.map((step) => step.nodeId)).toEqual([
      'start',
      'corregir',
      'corregir',
      'corregir',
      'escalar',
      'fin'
    ])
  })
  it('hands chat steps to the workspace chat and runs topo steps itself', async () => {
    const flow = flowOf(
      [
        agent('idea', { runner: 'chat', allowEdits: false }),
        agent('mesa', { runner: 'topo' }),
        agent('plan', { runner: 'chat', inputs: ['mesa'] })
      ],
      [edge('start', 'idea'), edge('idea', 'mesa'), edge('mesa', 'plan'), edge('plan', 'fin')]
    )
    const { launch, replies } = controlledLauncher()
    const run = {
      ...runOf(flow, { intent: 'Tablero' }),
      mode: 'chat' as const,
      chatSessionId: 's1'
    }
    const engine = new HarnessRunEngine(run, { launch, onChange: () => {} })
    engine.start()
    await settle()
    expect(run.chatTasks.map((task) => [task.nodeId, task.allowEdits])).toEqual([['idea', false]])
    expect(replies.size).toBe(0)

    expect(engine.completeChat({ taskId: 'nope', output: '', outcome: null })).toBe(false)
    engine.completeChat({ taskId: run.chatTasks[0]!.id, output: 'Idea v1', outcome: null })
    await settle()
    expect(run.chatTasks).toEqual([])
    expect([...replies.keys()]).toEqual(['mesa'])

    replies.get('mesa')!('preguntas de la mesa')
    await settle()
    expect(run.chatTasks.map((task) => task.nodeId)).toEqual(['plan'])
    expect(run.chatTasks[0]!.instructions).toContain('### mesa\npreguntas de la mesa')

    engine.completeChat({ taskId: run.chatTasks[0]!.id, output: 'Plan', outcome: null })
    await settle()
    expect(run.status).toBe('completed')
  })
})
