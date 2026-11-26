import { describe, expect, it } from 'vitest'
import { outcomeChoices } from './harness-agent-prompt'
import { normalizeHarnessFlow } from './harness-flow-normalize'
import { harnessFlowProblems } from './harness-flow-problems'
import { createHarnessTicketFlow } from './harness-ticket-flow'

const flow = createHarnessTicketFlow(0)

describe('ticket flow', () => {
  it('is a valid flow that survives normalization unchanged', () => {
    expect(harnessFlowProblems(flow)).toEqual([])
    expect(normalizeHarnessFlow(flow)).toEqual(flow)
  })

  it('never waits for a person: no human nodes and every loop escalates', () => {
    expect(flow.nodes.filter((node) => node.kind === 'human')).toEqual([])
    const unbounded = flow.nodes.filter(
      (node) => 'limitTarget' in node && !node.limitTarget && node.id !== flow.escalationNode
    )
    expect(unbounded.map((node) => node.id)).toEqual([])
  })

  it('routes the classifier to every path and fans the reviewers out together', () => {
    expect(outcomeChoices(flow, 'tomar', {})).toEqual([
      'Bug',
      'Mejora',
      'Sin código',
      'No es para agentes'
    ])
    const reviewers = flow.edges
      .filter((edge) => edge.source === 'analisis' && edge.label === 'Todo cumple')
      .map((edge) => edge.target)
    expect(reviewers).toEqual([
      'revisor_bugs',
      'revisor_regresiones',
      'revisor_calidad',
      'revisor_seguridad'
    ])
  })

  it('reaches both ends', () => {
    const ends = flow.nodes.filter((node) => node.kind === 'end').map((node) => node.id)
    const targets = new Set(flow.edges.map((edge) => edge.target))
    expect(ends.every((id) => targets.has(id))).toBe(true)
  })
})
