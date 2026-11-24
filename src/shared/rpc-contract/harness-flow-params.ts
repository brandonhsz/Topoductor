import { z } from 'zod'
import { HARNESS_FLOW_VERSION_SUMMARY_MAX } from '../harness/harness-flow-version-types'
import { HarnessCaller } from './harness-params'

const FlowId = z.string().min(1).max(256)

export const HarnessFlowsListParams = HarnessCaller.strict()

export const HarnessFlowsGetParams = HarnessCaller.extend({ flowId: FlowId }).strict()

/** `flow` is validated by normalizeHarnessFlow; `scope` only applies when creating. */
export const HarnessFlowsSaveParams = HarnessCaller.extend({
  flow: z.record(z.string(), z.unknown()),
  summary: z.string().trim().min(1).max(HARNESS_FLOW_VERSION_SUMMARY_MAX),
  expectedUpdatedAt: z.number().int().nonnegative().optional(),
  scope: z.enum(['global', 'repo']).optional()
}).strict()
