import type { HarnessFlow } from './harness-flow-types'
import {
  createHarnessExampleFlow,
  HARNESS_EXAMPLE_FLOW_ID,
  HARNESS_EXAMPLE_FLOW_VERSION
} from './harness-example-flow'
import {
  createHarnessTicketFlow,
  HARNESS_TICKET_FLOW_ID,
  HARNESS_TICKET_FLOW_VERSION
} from './harness-ticket-flow'

export type HarnessBuiltinFlow = {
  id: string
  version: number
  create: (now: number) => HarnessFlow
}

/** Flows Topo ships and keeps current until the person edits them, in catalog order. */
export const HARNESS_BUILTIN_FLOWS: readonly HarnessBuiltinFlow[] = [
  {
    id: HARNESS_EXAMPLE_FLOW_ID,
    version: HARNESS_EXAMPLE_FLOW_VERSION,
    create: createHarnessExampleFlow
  },
  {
    id: HARNESS_TICKET_FLOW_ID,
    version: HARNESS_TICKET_FLOW_VERSION,
    create: createHarnessTicketFlow
  }
]
