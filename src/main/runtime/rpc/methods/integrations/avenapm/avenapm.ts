import type { AvenaPMTask } from '../../../../../../shared/avenapm/avenapm-types'
import { AvenaPMQueueParams } from '../../../../../../shared/rpc-contract/avenapm-params'
import { listAvenaPMTasks } from '../../../../../avenapm/avenapm-client'
import { defineMethod } from '../../../core'

export type AvenaPMQueueResult = { queueName: string; tasks: AvenaPMTask[] }

export const AVENAPM_METHODS = [
  defineMethod({
    name: 'avenapm.queue',
    permission: 'workspace',
    params: AvenaPMQueueParams,
    handler: async (params): Promise<AvenaPMQueueResult> => {
      const result = await listAvenaPMTasks({ status: params.status ?? null })
      if (!result.ok) {
        throw new Error(`avenapm_${result.reason}: ${result.message}`)
      }
      return {
        queueName: result.queueName,
        tasks: params.unassigned
          ? result.tasks.filter((task) => task.assignee === null)
          : result.tasks
      }
    }
  })
]
