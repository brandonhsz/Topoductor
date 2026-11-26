import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvenaPMTask } from '../../../../../../shared/avenapm/avenapm-types'
import { eraseRpcMethods, type RpcContext, type RpcMethod } from '../../../core'
import { AVENAPM_METHODS, type AvenaPMQueueResult } from './avenapm'

const client = vi.hoisted(() => ({ listAvenaPMTasks: vi.fn() }))
vi.mock('../../../../../avenapm/avenapm-task-queue', () => client)

function task(shortId: string, assignee: AvenaPMTask['assignee']): AvenaPMTask {
  return {
    id: shortId,
    shortId,
    title: shortId,
    description: null,
    status: 'por_hacer',
    priority: null,
    size: null,
    classification: 'bug',
    assignee,
    source: null,
    url: '',
    createdAt: '',
    updatedAt: '',
    doneAt: null
  }
}

const context: RpcContext = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: avenapm.queue never reads the runtime.
  runtime: {} as unknown as RpcContext['runtime'],
  caller: { kind: 'local-cli' }
}

function queue(params: Record<string, unknown>): Promise<AvenaPMQueueResult> {
  const method = eraseRpcMethods(AVENAPM_METHODS).find(
    (entry): entry is RpcMethod & { handler: RpcMethod['handler'] } =>
      entry.name === 'avenapm.queue' && !('stream' in entry)
  )!
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: eraseRpcMethods erases the declared AvenaPMQueueResult.
  return method.handler(params, context) as Promise<AvenaPMQueueResult>
}

describe('avenapm.queue', () => {
  beforeEach(() => {
    client.listAvenaPMTasks.mockReset().mockResolvedValue({
      ok: true,
      queueName: 'Operación',
      tasks: [task('OP-1', null), task('OP-2', { email: 'a@b.c', name: 'A' })]
    })
  })

  it('filters to unowned tickets and passes the status through', async () => {
    const result = await queue({ status: 'por_hacer', unassigned: true })
    expect(client.listAvenaPMTasks).toHaveBeenCalledWith({ status: 'por_hacer' })
    expect(result.tasks.map((entry) => entry.shortId)).toEqual(['OP-1'])
  })

  it('reports a disconnected account as an error instead of an empty queue', async () => {
    client.listAvenaPMTasks.mockResolvedValue({
      ok: false,
      reason: 'not_connected',
      message: 'AvenaPM is not connected.'
    })
    await expect(queue({})).rejects.toThrow(/avenapm_not_connected/)
  })
})
