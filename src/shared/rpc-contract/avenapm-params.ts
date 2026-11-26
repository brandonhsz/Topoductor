import { z } from 'zod'
import { AVENAPM_TASK_STATUSES } from '../avenapm/avenapm-types'

/** Reads the operation queue, e.g. from an automation precheck. */
export const AvenaPMQueueParams = z
  .object({
    status: z.enum(AVENAPM_TASK_STATUSES).optional(),
    /** Only tickets nobody owns yet. */
    unassigned: z.boolean().optional()
  })
  .strict()
