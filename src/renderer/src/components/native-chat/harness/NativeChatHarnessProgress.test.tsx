// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessFlowProgress,
  HarnessFlowProgressAgent
} from '../../../../../shared/harness/harness-flow-progress'
import { NativeChatHarnessProgress } from './NativeChatHarnessProgress'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    String(values?.count === 1 ? (values.defaultValue_one ?? fallback) : fallback).replace(
      /{{(\w+)}}/g,
      (_match, key) => String(values?.[key] ?? '')
    )
}))
afterEach(cleanup)

const NOW = 1_000_000

function agentRow(patch: Partial<HarnessFlowProgressAgent>): HarnessFlowProgressAgent {
  return {
    kind: 'agent',
    key: patch.stepId ?? 'step',
    stepId: 'step',
    title: 'Cierre oleada 2',
    status: 'running',
    outcome: null,
    agent: 'codex',
    session: { kind: 'structured', worktreeId: 'wt', sessionId: 'hidden', tabless: true },
    startedAt: NOW - 2 * 60_000,
    activity: null,
    attention: false,
    decision: null,
    ...patch
  }
}

const runningRow = agentRow({ stepId: 'c2', activity: 'Bash: pnpm test' })

const progress: HarnessFlowProgress = {
  flowName: 'De la intención a la entrega',
  block: 'Bloque 2',
  tabless: 2,
  attention: 0,
  rows: [
    {
      kind: 'subagents',
      key: 'mesa',
      group: 'Bloque 1 · Mesa',
      done: 3,
      total: 3,
      agents: [
        { id: 's1', title: 'Revisor de seguridad', status: 'done', output: 'Sin hallazgos' },
        { id: 's2', title: 'Revisor de UX', status: 'done', output: 'Foco visible' },
        { id: 's3', title: 'Revisor de pruebas', status: 'done', output: 'Cubre el caso' }
      ]
    },
    agentRow({ stepId: 'c1', title: 'Cierre oleada 1', status: 'done', outcome: 'ok' }),
    runningRow
  ]
}

function header(): HTMLElement {
  return screen.getByRole('button', { name: /De la intención a la entrega/ })
}

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest('li')!
}

describe('NativeChatHarnessProgress', () => {
  it('renders nothing without a flow in progress', () => {
    const { container } = render(
      <NativeChatHarnessProgress progress={null} onOpenSession={vi.fn()} onAnswer={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('starts collapsed to the flow, its current block and how many agents have no tab', () => {
    render(
      <NativeChatHarnessProgress
        progress={progress}
        now={NOW}
        onOpenSession={vi.fn()}
        onAnswer={vi.fn()}
      />
    )
    expect(header().textContent).toContain('De la intención a la entrega · Bloque 2')
    expect(header().textContent).toContain('2 agents without a tab')
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Cierre oleada 1')).toBeNull()
  })

  it('expands to each group in run order and opens a tabless agent on demand', () => {
    const onOpenSession = vi.fn()
    render(
      <NativeChatHarnessProgress
        progress={progress}
        now={NOW}
        onOpenSession={onOpenSession}
        onAnswer={vi.fn()}
      />
    )
    fireEvent.click(header())
    expect(header().getAttribute('aria-expanded')).toBe('true')

    const titles = screen.getAllByRole('listitem').map((item) => item.dataset.title)
    expect(titles).toEqual(['Bloque 1 · Mesa', 'Cierre oleada 1', 'Cierre oleada 2'])

    const mesa = rowOf('Bloque 1 · Mesa')
    expect(mesa.textContent).toContain('3/3')
    expect(within(mesa).getByText('subagents')).toBeTruthy()

    const closed = rowOf('Cierre oleada 1')
    expect(closed.dataset.status).toBe('done')
    expect(closed.textContent).toContain('ok')

    const running = rowOf('Cierre oleada 2')
    expect(running.dataset.status).toBe('running')
    expect(running.textContent).toContain('working · 2 min')
    expect(running.textContent).toContain('Bash: pnpm test')
    expect(within(running).getByText('Codex · Topo agent')).toBeTruthy()
    fireEvent.click(within(running).getByRole('button', { name: 'Open chat' }))
    expect(onOpenSession).toHaveBeenCalledWith(runningRow.session)

    fireEvent.click(header())
    expect(screen.queryByText('Cierre oleada 1')).toBeNull()
  })

  it('marks an agent that waits on the person and answers its decision', () => {
    const onAnswer = vi.fn()
    const onOpenSession = vi.fn()
    const waiting: HarnessFlowProgress = {
      ...progress,
      attention: 1,
      rows: [
        agentRow({
          stepId: 'r1',
          title: '🔎 Revisor: seguridad',
          status: 'failed',
          attention: true,
          decision: { id: 'd1', choices: ['Reintentar', 'Omitir y seguir', 'Detener'] }
        })
      ]
    }
    render(
      <NativeChatHarnessProgress
        progress={waiting}
        now={NOW}
        onOpenSession={onOpenSession}
        onAnswer={onAnswer}
      />
    )
    expect(header().textContent).toContain('1 agent needs you')
    fireEvent.click(header())
    const row = rowOf('🔎 Revisor: seguridad')
    expect(row.dataset.attention).toBe('true')
    fireEvent.click(within(row).getByRole('button', { name: 'Open chat and reply' }))
    expect(onOpenSession).toHaveBeenCalledOnce()
    fireEvent.click(within(row).getByRole('button', { name: 'Omitir y seguir' }))
    expect(onAnswer).toHaveBeenCalledWith('d1', 'Omitir y seguir')
  })
})
