import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { AVENAPM_TASK_STATUSES, type AvenaPMTask } from '../../shared/avenapm/avenapm-types'

type AvenaPMQueueResult = { queueName: string; tasks: AvenaPMTask[] }

function statusFlag(flags: Map<string, string | boolean>): string | undefined {
  const status = getOptionalStringFlag(flags, 'status')
  if (status !== undefined && !AVENAPM_TASK_STATUSES.some((entry) => entry === status)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--status must be one of: ${AVENAPM_TASK_STATUSES.join(', ')}.`
    )
  }
  return status
}

function formatQueue(result: AvenaPMQueueResult): string {
  if (result.tasks.length === 0) {
    return `${result.queueName}: no tickets match.`
  }
  return [
    `${result.queueName}: ${result.tasks.length} ticket(s)`,
    ...result.tasks.map(
      (task) =>
        `${task.shortId ?? task.id}\t${task.status}\t${task.assignee?.email ?? 'sin dueño'}\t${task.title}`
    )
  ].join('\n')
}

export const AVENAPM_HANDLERS: Record<string, CommandHandler> = {
  'avenapm queue': async ({ flags, client, json }) => {
    const status = statusFlag(flags)
    const result = await client.call<AvenaPMQueueResult>('avenapm.queue', {
      ...(status ? { status } : {}),
      ...(flags.get('unassigned') === true ? { unassigned: true } : {})
    })
    printResult(result, json, formatQueue)
    if (flags.get('require-any') === true && result.result.tasks.length === 0) {
      process.exitCode = 1
    }
  }
}
