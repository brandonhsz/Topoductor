import { describe, expect, it } from 'vitest'
import { normalizeHarnessFlow } from './harness-flow-normalize'

function rawFlow(node: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    id: 'f',
    name: 'Flujo',
    description: '',
    scope: { kind: 'global' },
    defaultAgent: 'claude',
    nodes: [{ kind: 'start', id: 'start', title: 'Inicio', fields: [] }, node],
    edges: []
  }
}

describe('normalizeHarnessFlow runner', () => {
  it('keeps subagent on agent nodes', () => {
    const flow = normalizeHarnessFlow(
      rawFlow({ kind: 'agent', id: 'mesa', title: 'Mesa', prompt: 'p', runner: 'subagent' })
    )
    expect(flow?.nodes.find((node) => node.id === 'mesa')).toMatchObject({ runner: 'subagent' })
  })

  it('turns subagent into chat on waves nodes', () => {
    const flow = normalizeHarnessFlow(
      rawFlow({ kind: 'waves', id: 'olas', title: 'Olas', planKey: 'plan', runner: 'subagent' })
    )
    expect(flow?.nodes.find((node) => node.id === 'olas')).toMatchObject({ runner: 'chat' })
  })

  it('keeps reading unknown runners as chat', () => {
    const flow = normalizeHarnessFlow(
      rawFlow({ kind: 'agent', id: 'x', title: 'X', prompt: 'p', runner: 'otro' })
    )
    expect(flow?.nodes.find((node) => node.id === 'x')).toMatchObject({ runner: 'chat' })
  })
})
