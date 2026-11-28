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

  it('asks how to continue when a skipped step only leaves through labeled edges', async () => {
    const flow = flowOf(
      [agent('analisis'), agent('corregir')],
      [
        edge('start', 'analisis'),
        edge('analisis', 'corregir', 'Hay hallazgos'),
        edge('analisis', 'fin', 'Todo cumple'),
        edge('corregir', 'fin')
      ]
    )
    const launch: HarnessAgentLauncher = async () => ({ ok: false, error: 'sin cuota' })
    const run = runOf(flow, { intent: 'Revisar' })
    const engine = new HarnessRunEngine(run, { launch, onChange: () => {} })
    engine.start()
    await settle()
    engine.answer({
      decisionId: run.pending[0]!.id,
      choice: 'Omitir y seguir',
      text: '',
      fields: {}
    })
    await settle()

    expect(run.status).toBe('waiting')
    expect(run.pending[0]!.choices).toEqual(['Hay hallazgos', 'Todo cumple'])
    engine.answer({ decisionId: run.pending[0]!.id, choice: 'Todo cumple', text: '', fields: {} })
    await settle()
    expect(run.status).toBe('completed')
    expect(run.steps.at(-1)!.nodeId).toBe('fin')
  })

  it('hands fresh inputs again only after they are rewritten', async () => {
    const flow = flowOf(
      [
        agent('analisis', { inputs: ['plan', 'correccion'], freshInputs: ['correccion'] }),
        agent('correccion', { inputs: ['analisis'] })
      ],
      [
        edge('start', 'analisis'),
        edge('analisis', 'correccion', 'Hay hallazgos'),
        edge('analisis', 'analisis', 'Repetir'),
        edge('analisis', 'fin', 'Todo cumple'),
        edge('correccion', 'analisis')
      ]
    )
    const { launch, replies, prompts } = controlledLauncher()
    const run = runOf(flow, { plan: 'PLAN-1' })
    new HarnessRunEngine(run, { launch, onChange: () => {} }).start()
    await settle()
    replies.get('analisis')!('SALIDA: Hay hallazgos')
    await settle()
    replies.get('correccion')!('CORRECCION-1')
    await settle()
    expect(prompts.at(-1)).toContain('CORRECCION-1')

    replies.get('analisis')!('SALIDA: Repetir')
    await settle()
    expect(prompts.at(-1)).toContain('PLAN-1')
    expect(prompts.at(-1)).not.toContain('CORRECCION-1')
  })

  it('sends a plan that breaks its wave rules back to the node that wrote it', async () => {
    const flow = flowOf(
      [
        agent('plan', { inputs: ['plan_problemas'], freshInputs: ['plan_problemas'] }),
        {
          kind: 'waves',
          id: 'ejecucion',
          title: 'Ejecución',
          block: '',
          position: at,
          planKey: 'plan',
          roles: [{ name: 'Lógica', agent: null, prompt: 'TAREA:tarea', paths: [] }],
          verifyCommand: '',
          checkpointEachWave: false,
          runner: 'topo',
          allowEdits: true,
          inputs: [],
          outputKey: 'ejecucion',
          joinAll: false,
          maxVisits: 5,
          limitTarget: null
        }
      ],
      [edge('start', 'plan'), edge('plan', 'ejecucion'), edge('ejecucion', 'fin')]
    )
    const conflicting = JSON.stringify({
      tasks: [
        { id: 'T1', role: 'Lógica', title: 'a', wave: 0, files: ['a.ts'] },
        { id: 'T2', role: 'Lógica', title: 'b', wave: 0, files: ['a.ts'] }
      ]
    })
    const { launch, replies, prompts } = controlledLauncher()
    const run = runOf(flow, {})
    const engine = new HarnessRunEngine(run, { launch, onChange: () => {} })
    engine.start()
    await settle()
    replies.get('plan')!(`\`\`\`json\n${conflicting}\n\`\`\``)
    await settle()

    expect(run.pending[0]!.choices).toEqual(['Volver al plan', 'Continuar', 'Detener'])
    engine.answer({
      decisionId: run.pending[0]!.id,
      choice: 'Volver al plan',
      text: '',
      fields: {}
    })
    await settle()
    expect(prompts.at(-1)).toContain('TAREA:plan')
    expect(prompts.at(-1)).toContain('T1 y T2 tocan a.ts en la misma oleada 0.')
  })

  describe('flows with an escalation node', () => {
    function unattended(extra: HarnessNode[] = [], edges: HarnessEdge[] = []): HarnessFlow {
      return {
        ...flowOf(
          [agent('trabajo'), agent('escalar', { inputs: ['motivo_escalado'] }), ...extra],
          [edge('start', 'trabajo'), edge('trabajo', 'fin'), edge('escalar', 'fin'), ...edges]
        ),
        escalationNode: 'escalar'
      }
    }

    it('sends a failed step to the escalation node instead of waiting', async () => {
      const prompts: string[] = []
      const launch: HarnessAgentLauncher = async (request) => {
        prompts.push(request.prompt)
        return request.prompt.includes('TAREA:trabajo')
          ? { ok: false, error: 'sin cuota' }
          : { ok: true, text: 'comentado' }
      }
      const run = runOf(unattended(), {})
      new HarnessRunEngine(run, { launch, onChange: () => {} }).start()
      await settle()

      expect(run.pending).toEqual([])
      expect(run.status).toBe('completed')
      expect(run.steps.map((step) => step.nodeId)).toEqual(['start', 'trabajo', 'escalar', 'fin'])
      expect(prompts.at(-1)).toContain('El agente falló: sin cuota')
    })

    it('still asks a person in human nodes and when the escalation node itself fails', async () => {
      const launch: HarnessAgentLauncher = async () => ({ ok: false, error: 'caído' })
      const human: HarnessNode = {
        kind: 'human',
        id: 'persona',
        title: 'Persona',
        block: '',
        position: at,
        prompt: 'Decide',
        inputs: [],
        outputKey: 'persona',
        joinAll: false,
        maxVisits: 5,
        limitTarget: null
      }
      const run = runOf(
        { ...unattended([human], [edge('start', 'persona')]), escalationNode: 'escalar' },
        {}
      )
      new HarnessRunEngine(run, { launch, onChange: () => {} }).start()
      await settle()

      expect(run.pending.map((decision) => decision.nodeId).sort()).toEqual(['escalar', 'persona'])
    })

    function chatReview(): { run: HarnessRun; engine: HarnessRunEngine } {
      const flow: HarnessFlow = {
        ...flowOf(
          [
            agent('revision', { runner: 'chat' }),
            agent('corregir'),
            agent('escalar', { inputs: ['motivo_escalado'] })
          ],
          [
            edge('start', 'revision'),
            edge('revision', 'corregir', 'Hay hallazgos'),
            edge('revision', 'fin', 'Todo cumple'),
            edge('corregir', 'fin'),
            edge('escalar', 'fin')
          ]
        ),
        escalationNode: 'escalar'
      }
      const run: HarnessRun = { ...runOf(flow, {}), mode: 'chat', chatSessionId: 's1' }
      const engine = new HarnessRunEngine(run, {
        launch: controlledLauncher().launch,
        onChange: () => {}
      })
      engine.start()
      return { run, engine }
    }

    it('rejects a chat completion without an outcome and keeps the task open', async () => {
      const { run, engine } = chatReview()
      await settle()
      const taskId = run.chatTasks[0]!.id

      expect(() => engine.completeChat({ taskId, output: 'Listo', outcome: null })).toThrow(
        `harness_outcome_required: la tarea ${taskId} necesita --outcome. Salidas válidas: «Hay hallazgos», «Todo cumple». La tarea sigue abierta; reintenta: topo harness complete --task ${taskId} --output-file <archivo con tu entregable> --outcome "<Hay hallazgos | Todo cumple>"`
      )
      await settle()
      expect(run.chatTasks.map((task) => task.id)).toEqual([taskId])
      expect(run.pending).toEqual([])
      expect(run.steps.map((step) => step.nodeId)).toEqual(['start', 'revision'])

      expect(engine.completeChat({ taskId, output: 'Listo', outcome: 'todo cumple' })).toBe(true)
      await settle()
      expect(run.status).toBe('completed')
      expect(run.steps.map((step) => [step.nodeId, step.outcome])).toEqual([
        ['start', null],
        ['revision', 'Todo cumple'],
        ['fin', null]
      ])
    })

    it('rejects an outcome that is not one of the labels', async () => {
      const { run, engine } = chatReview()
      await settle()
      const taskId = run.chatTasks[0]!.id

      expect(() => engine.completeChat({ taskId, output: 'Listo', outcome: 'Resuelto' })).toThrow(
        /^harness_outcome_invalid: «Resuelto» no es una salida .*«Hay hallazgos», «Todo cumple»/
      )
      await settle()
      expect(run.chatTasks.map((task) => task.id)).toEqual([taskId])
      expect(run.pending).toEqual([])
      expect(run.vars.motivo_escalado).toBeUndefined()
    })
  })

  describe('agents Topo runs for a chat', () => {
    function topoRun(mode: HarnessRun['mode']): HarnessRun {
      const flow = flowOf(
        [agent('cierre', { runner: 'topo' })],
        [edge('start', 'cierre'), edge('cierre', 'fin')]
      )
      return { ...runOf(flow, { intent: 'Tablero' }), mode, chatSessionId: 's1' }
    }

    it('launches them without a tab only when a chat drives the run', async () => {
      for (const mode of ['chat', 'orchestrated'] as const) {
        const requests: Parameters<HarnessAgentLauncher>[0][] = []
        const launch: HarnessAgentLauncher = (request) => {
          requests.push(request)
          return new Promise(() => {})
        }
        new HarnessRunEngine(topoRun(mode), { launch, onChange: () => {} }).start()
        await settle()
        expect(requests.map((request) => request.withoutTab)).toEqual([mode === 'chat'])
      }
    })

    it('closes the tabless sessions still working when the run stops', async () => {
      const closed: string[] = []
      const launch: HarnessAgentLauncher = (_request, onSession) => {
        onSession({ kind: 'structured', worktreeId: 'wt', sessionId: 'hidden', tabless: true })
        return new Promise(() => {})
      }
      const run = topoRun('chat')
      const engine = new HarnessRunEngine(run, {
        launch,
        onChange: () => {},
        closeSession: (session) => {
          closed.push(session.kind === 'structured' ? session.sessionId : session.handle)
        }
      })
      engine.start()
      await settle()
      expect(closed).toEqual([])
      engine.stop()
      expect(closed).toEqual(['hidden'])
      expect(run.steps.find((step) => step.nodeId === 'cierre')!.status).toBe('stopped')
    })

    it('leaves sessions that have a tab, or that finished, to the person', async () => {
      const closed: string[] = []
      let calls = 0
      const launch: HarnessAgentLauncher = (_request, onSession) => {
        calls++
        onSession(
          calls === 1
            ? { kind: 'structured', worktreeId: 'wt', sessionId: 'done', tabless: true }
            : { kind: 'structured', worktreeId: 'wt', sessionId: 'tabbed' }
        )
        return calls === 1 ? Promise.resolve({ ok: true, text: 'ok' }) : new Promise(() => {})
      }
      const flow = flowOf(
        [agent('a', { runner: 'topo' }), agent('b', { runner: 'topo' })],
        [edge('start', 'a'), edge('a', 'b'), edge('b', 'fin')]
      )
      const engine = new HarnessRunEngine(
        { ...runOf(flow, { intent: 'x' }), mode: 'chat', chatSessionId: 's1' },
        {
          launch,
          onChange: () => {},
          closeSession: (session) => {
            closed.push(session.kind === 'structured' ? session.sessionId : session.handle)
          }
        }
      )
      engine.start()
      await settle()
      engine.stop()
      expect(closed).toEqual([])
    })
  })

  describe('subagent steps', () => {
    function mesaFlow(extra: Partial<HarnessAgentNode> = {}): HarnessFlow {
      return flowOf(
        [
          agent('u', { runner: 'subagent', block: 'Mesa', ...extra }),
          agent('i', { runner: 'subagent', block: 'Mesa', ...extra }),
          agent('sintesis', { runner: 'chat', inputs: ['u', 'i'], joinAll: true })
        ],
        [
          edge('start', 'u'),
          edge('start', 'i'),
          edge('u', 'sintesis'),
          edge('i', 'sintesis'),
          edge('sintesis', 'fin')
        ]
      )
    }

    function chatRun(flow: HarnessFlow): HarnessRun {
      return { ...runOf(flow, { intent: 'Tablero' }), mode: 'chat', chatSessionId: 's1' }
    }

    it('opens one marked subagent task per node and completes it only with the exact prompt', async () => {
      const { launch, replies } = controlledLauncher()
      const run = chatRun(mesaFlow())
      const engine = new HarnessRunEngine(run, {
        launch,
        onChange: () => {},
        chatProvider: async () => 'claude'
      })
      engine.start()
      await settle()

      expect(replies.size).toBe(0)
      expect(run.chatTasks.map((task) => [task.nodeId, task.delivery])).toEqual([
        ['u', 'subagent'],
        ['i', 'subagent']
      ])
      const [u, i] = run.chatTasks
      expect(u!.subagent!.prompt.split('\n')[0]).toBe(`[topo-harness-task:${u!.id}]`)
      expect(u!.subagent!.prompt).toContain('TAREA:u')
      expect(u!.subagent!.label).toBe('u')

      expect(
        engine.completeChat({ taskId: u!.id, output: 'resumen del chat', outcome: null })
      ).toBe(false)
      expect(run.chatTasks).toHaveLength(2)

      const tampered = engine.completeSubagent(`${u!.subagent!.prompt}\nOpina como el chat.`, 'x')
      expect(tampered).toEqual({ taskId: null, reason: expect.any(String) })
      expect(run.chatTasks).toHaveLength(2)

      expect(engine.completeSubagent(u!.subagent!.prompt, 'crítica cruda U')).toEqual({
        taskId: u!.id,
        reason: null
      })
      expect(engine.completeSubagent(i!.subagent!.prompt, 'crítica cruda I').taskId).toBe(i!.id)
      await settle()

      expect(run.vars.u).toBe('crítica cruda U')
      expect(run.vars.i).toBe('crítica cruda I')
      expect(run.steps.find((step) => step.nodeId === 'u')!.runner).toBe('subagent')
      expect(run.chatTasks.map((task) => [task.nodeId, task.delivery ?? 'self'])).toEqual([
        ['sintesis', 'self']
      ])
      expect(run.chatTasks[0]!.instructions).toContain('crítica cruda U')
    })

    it('falls back to its own agents when the chat cannot host subagents', async () => {
      const { launch, replies } = controlledLauncher()
      const run = chatRun(mesaFlow())
      const engine = new HarnessRunEngine(run, {
        launch,
        onChange: () => {},
        chatProvider: async () => 'codex'
      })
      engine.start()
      await settle()

      expect(run.chatTasks).toEqual([])
      expect([...replies.keys()].sort()).toEqual(['i', 'u'])
      expect(run.steps.find((step) => step.nodeId === 'u')!.runner).toBe('topo')
    })

    it('falls back when the node pins an agent other than the chat', async () => {
      const { launch, replies } = controlledLauncher()
      const run = chatRun(mesaFlow({ agent: 'codex' }))
      const engine = new HarnessRunEngine(run, {
        launch,
        onChange: () => {},
        chatProvider: async () => 'claude'
      })
      engine.start()
      await settle()

      expect(run.chatTasks).toEqual([])
      expect([...replies.keys()].sort()).toEqual(['i', 'u'])
    })
  })
})
