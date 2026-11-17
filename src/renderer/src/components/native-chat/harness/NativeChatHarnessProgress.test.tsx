// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessSubagentProgress } from '../../../../../shared/harness/harness-subagent-contract'
import { NativeChatHarnessProgress } from './NativeChatHarnessProgress'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key) => String(values?.[key] ?? ''))
}))
afterEach(cleanup)

const progress: HarnessSubagentProgress = {
  group: 'Bloque 1 · Mesa',
  done: 2,
  total: 3,
  agents: [
    { id: 's1', title: 'Revisor de seguridad', status: 'done', output: 'Sin hallazgos críticos' },
    {
      id: 's2',
      title: 'Revisor de UX',
      status: 'failed',
      output: 'El botón no tiene foco visible'
    },
    { id: 's3', title: 'Revisor de pruebas', status: 'running', output: 'borrador parcial' }
  ]
}

function line(): HTMLElement {
  return screen.getByRole('button', { name: /Bloque 1 · Mesa/ })
}

describe('NativeChatHarnessProgress', () => {
  it('renders nothing without subagent progress', () => {
    const { container } = render(<NativeChatHarnessProgress progress={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('starts as one compact line with the group and the done/total count', () => {
    render(<NativeChatHarnessProgress progress={progress} />)
    expect(line().textContent).toContain('Bloque 1 · Mesa')
    expect(line().textContent).toContain('2/3')
    expect(line().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Revisor de seguridad')).toBeNull()
    expect(screen.queryByText('Sin hallazgos críticos')).toBeNull()
  })

  it('expands to every agent with its status and finished output, and collapses again', () => {
    render(<NativeChatHarnessProgress progress={progress} />)
    fireEvent.click(line())
    expect(line().getAttribute('aria-expanded')).toBe('true')

    for (const agent of progress.agents) {
      const title = screen.getByText(agent.title)
      expect(title.closest('[data-status]')?.getAttribute('data-status')).toBe(agent.status)
    }
    expect(screen.getByText('Sin hallazgos críticos')).toBeTruthy()
    expect(screen.getByText('El botón no tiene foco visible')).toBeTruthy()
    expect(screen.queryByText('borrador parcial')).toBeNull()

    fireEvent.click(line())
    expect(line().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Revisor de seguridad')).toBeNull()
  })
})
