import { defineFixture } from '../../../component-fixtures/component-fixture'
import type {
  HarnessFlowProgress,
  HarnessFlowProgressAgent
} from '../../../../../shared/harness/harness-flow-progress'
import { NativeChatHarnessProgress } from './NativeChatHarnessProgress'

const NOW = Date.UTC(2026, 10, 17, 12)

function agent(patch: Partial<HarnessFlowProgressAgent>): HarnessFlowProgressAgent {
  const stepId = patch.stepId ?? 'step'
  return {
    kind: 'agent',
    key: stepId,
    stepId,
    title: 'Cierre oleada 2',
    status: 'running',
    outcome: null,
    agent: 'codex',
    session: { kind: 'structured', worktreeId: 'wt', sessionId: stepId, tabless: true },
    startedAt: NOW - 2 * 60_000,
    activity: null,
    attention: false,
    decision: null,
    ...patch
  }
}

const mesa = {
  kind: 'subagents' as const,
  key: 'mesa',
  group: 'Bloque 1 · Mesa',
  done: 3,
  total: 3,
  agents: [
    { id: 's1', title: '🧭 Agente Usabilidad', status: 'done' as const, output: '' },
    { id: 's2', title: '🛠️ Agente Ingeniero', status: 'done' as const, output: '' },
    { id: 's3', title: '⚖️ Agente Viabilidad', status: 'done' as const, output: '' }
  ]
}

const running: HarnessFlowProgress = {
  flowName: 'De la intención a la entrega',
  block: 'Bloque 2',
  tabless: 3,
  attention: 0,
  rows: [
    mesa,
    agent({ stepId: 'c1', title: 'Cierre oleada 1', status: 'done', outcome: 'ok' }),
    agent({ stepId: 'c2', activity: 'Bash: pnpm test --maxWorkers=2' }),
    agent({
      stepId: 'r1',
      title: '🔎 Revisor: seguridad',
      status: 'waiting',
      agent: 'claude',
      session: null
    })
  ]
}

const attention: HarnessFlowProgress = {
  ...running,
  block: 'Interrogatorio',
  attention: 1,
  rows: [
    mesa,
    agent({ stepId: 'c1', title: 'Cierre oleada 1', status: 'done', outcome: 'ok' }),
    agent({
      stepId: 'r1',
      title: '🔎 Revisor: seguridad',
      status: 'failed',
      agent: 'claude',
      attention: true,
      decision: { id: 'd1', choices: ['Reintentar', 'Omitir y seguir', 'Detener'] }
    })
  ]
}

const noop = (): void => {}
const expand = (frame: HTMLElement): void =>
  frame.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()

export const collapsed = defineFixture({
  width: 560,
  render: () => (
    <NativeChatHarnessProgress progress={running} now={NOW} onOpenSession={noop} onAnswer={noop} />
  )
})

export const expanded = defineFixture({
  width: 560,
  render: () => (
    <NativeChatHarnessProgress progress={running} now={NOW} onOpenSession={noop} onAnswer={noop} />
  ),
  interact: expand
})

export const needsAttention = defineFixture({
  width: 560,
  render: () => (
    <NativeChatHarnessProgress
      progress={attention}
      now={NOW}
      onOpenSession={noop}
      onAnswer={noop}
    />
  ),
  interact: expand
})
