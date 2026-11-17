// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentNode } from '../../../../shared/harness/harness-flow-types'
import { HarnessNodeInspector } from './HarnessNodeInspector'
import { createEmptyHarnessFlow, createHarnessNode } from './harness-flow-editing'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key) => values?.[key] ?? '')
}))
afterEach(cleanup)

function renderAgentInspector() {
  const empty = createEmptyHarnessFlow({
    name: 'Flow',
    start: 'Start',
    intent: 'Intent',
    end: 'End'
  })
  const node = createHarnessNode(empty, 'agent', { x: 0, y: 0 }, 'Mesa') as HarnessAgentNode
  const flow = { ...empty, nodes: [...empty.nodes, node] }
  const onChange = vi.fn()
  render(<HarnessNodeInspector flow={flow} node={node} onChange={onChange} onDelete={vi.fn()} />)
  return { node, onChange }
}

describe('HarnessNodeInspector runner', () => {
  it('offers the chat subagents as a third runner', async () => {
    const { node, onChange } = renderAgentInspector()
    fireEvent.click(screen.getByRole('combobox', { name: 'Who runs it' }))
    expect(await screen.findByRole('option', { name: 'The workspace chat' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Topo, with its own agent' })).toBeTruthy()

    fireEvent.click(screen.getByRole('option', { name: /subagent/i }))

    expect(onChange).toHaveBeenCalledWith({ ...node, runner: 'subagent' })
  })
})
