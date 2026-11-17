import { defineFixture } from '../../component-fixtures/component-fixture'
import { createHarnessExampleFlow } from '../../../../shared/harness/harness-example-flow'
import type { HarnessRun, HarnessRunStep } from '../../../../shared/harness/harness-run-types'
import { HarnessFlowsView } from './HarnessFlowsView'
import { HarnessRunsView } from './HarnessRunsView'

const flow = createHarnessExampleFlow(0)

function step(
  nodeId: string,
  status: HarnessRunStep['status'],
  output = '',
  agent: HarnessRunStep['agent'] = 'claude'
): HarnessRunStep {
  const node = flow.nodes.find((entry) => entry.id === nodeId)!
  return {
    id: `s-${nodeId}`,
    nodeId,
    taskId: null,
    title: node.title,
    visit: 1,
    status,
    agent,
    session: status === 'running' ? { kind: 'structured', worktreeId: 'wt', sessionId: 's' } : null,
    output,
    outcome: null,
    error: null,
    startedAt: 0,
    endedAt: null
  }
}

const run: HarnessRun = {
  id: 'run-1',
  flowId: flow.id,
  flowName: flow.name,
  flow,
  worktreeId: 'wt',
  status: 'waiting',
  vars: { intent: 'Que el equipo vea en qué fase va cada tarea', tipo: 'feature' },
  steps: [
    step(
      'intent',
      'done',
      'Intent: Que el equipo vea en qué fase va cada tarea\nTipo: feature',
      null
    ),
    step('idea', 'done', '**Idea (v1):** Un tablero con columnas por fase…'),
    step('usabilidad', 'done', '1. ¿Quién mira el tablero y cuándo?'),
    step('ingeniero', 'done', '1. ¿De dónde sale la fase de cada tarjeta?'),
    step('viabilidad', 'done', 'Alineación: alta. 1. ¿Qué se puede dejar fuera?'),
    step('sintesis', 'done', '### Ronda 1\n**🧭 Usabilidad:** …'),
    step('respuesta', 'waiting', '', null)
  ],
  pending: [
    {
      id: 'd1',
      stepId: 's-respuesta',
      nodeId: 'respuesta',
      title: 'Respuesta del usuario',
      reason: 'human',
      prompt:
        'Responde las preguntas de la ronda y elige cómo seguir: más rondas, cambiar el Intent o consolidar la idea.',
      context: [{ key: 'sintesis', value: '### Ronda 1\n**🧭 Usabilidad:** …' }],
      choices: ['Quedan dudas abiertas', 'La intención cambió', 'Idea consolidada'],
      fields: [],
      createdAt: 0
    }
  ],
  error: null,
  createdAt: 1_763_000_000_000,
  updatedAt: 1_763_000_000_000
}

function mockHarnessApi(): void {
  Object.assign(window.api.harness, {
    listFlows: () => Promise.resolve([flow]),
    getRun: () => Promise.resolve(run)
  })
}

export const flows = defineFixture({
  width: 1280,
  setup: mockHarnessApi,
  render: () => (
    <div className="flex h-[760px] flex-col">
      <HarnessFlowsView
        workspace={{ worktreeId: 'wt', repoId: 'repo', name: 'inconnu' }}
        onRunStarted={() => {}}
      />
    </div>
  )
})

export const liveRun = defineFixture({
  width: 1280,
  setup: mockHarnessApi,
  render: () => (
    <div className="flex h-[760px] flex-col">
      <HarnessRunsView
        runs={[
          {
            id: run.id,
            flowId: run.flowId,
            flowName: run.flowName,
            worktreeId: 'wt',
            status: 'waiting',
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            pendingCount: 1
          }
        ]}
        selectedRunId={run.id}
        onSelectRun={() => {}}
      />
    </div>
  )
})
