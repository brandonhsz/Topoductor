import { describe, expect, it } from 'vitest'
import {
  createHarnessExampleFlow,
  HARNESS_EXAMPLE_FLOW_ID,
  HARNESS_EXAMPLE_FLOW_VERSION
} from '../../shared/harness/harness-example-flow'
import {
  HARNESS_TICKET_FLOW_ID,
  HARNESS_TICKET_FLOW_VERSION
} from '../../shared/harness/harness-ticket-flow'
import { withCurrentBuiltins, type HarnessSeedFile } from './harness-builtin-flow-seeding'

const EMPTY: HarnessSeedFile = {
  seeded: false,
  exampleVersion: 0,
  exampleSeededAt: null,
  builtins: {},
  flows: []
}

describe('withCurrentBuiltins', () => {
  it('seeds every built-in flow into a new file, in catalog order', () => {
    const next = withCurrentBuiltins(EMPTY, 5)!
    expect(next.flows.map((flow) => flow.id)).toEqual([
      HARNESS_EXAMPLE_FLOW_ID,
      HARNESS_TICKET_FLOW_ID
    ])
    expect(next).toMatchObject({
      seeded: true,
      exampleVersion: HARNESS_EXAMPLE_FLOW_VERSION,
      exampleSeededAt: 5,
      builtins: { [HARNESS_TICKET_FLOW_ID]: { version: HARNESS_TICKET_FLOW_VERSION, seededAt: 5 } }
    })
    expect(withCurrentBuiltins(next, 9)).toBeNull()
  })

  it('adds a new built-in to a file from before it existed without touching an edited example', () => {
    const edited = { ...createHarnessExampleFlow(1), name: 'Mío', updatedAt: 2 }
    const file: HarnessSeedFile = {
      ...EMPTY,
      seeded: true,
      exampleVersion: HARNESS_EXAMPLE_FLOW_VERSION,
      exampleSeededAt: 1,
      flows: [edited]
    }
    const next = withCurrentBuiltins(file, 7)!
    expect(next.flows.map((flow) => [flow.id, flow.name])).toEqual([
      [HARNESS_TICKET_FLOW_ID, 'Ticket automático (Avena PM)'],
      [HARNESS_EXAMPLE_FLOW_ID, 'Mío']
    ])
    expect(next.exampleSeededAt).toBe(1)
  })

  it('does not bring back a built-in the person deleted', () => {
    const file: HarnessSeedFile = {
      ...EMPTY,
      seeded: true,
      exampleVersion: 1,
      exampleSeededAt: 1,
      builtins: { [HARNESS_TICKET_FLOW_ID]: { version: 0, seededAt: 1 } }
    }
    const next = withCurrentBuiltins(file, 7)!
    expect(next.flows).toEqual([])
    expect(next.builtins[HARNESS_TICKET_FLOW_ID]!.version).toBe(HARNESS_TICKET_FLOW_VERSION)
  })
})
