import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarnessTicketFlow } from '../../../../../shared/harness/harness-ticket-flow'
import type { HarnessRun } from '../../../../../shared/harness/harness-run-types'
import { eraseRpcMethods, type RpcContext, type RpcMethod } from '../../core'
import { HARNESS_METHODS, type HarnessStartResult } from './harness'

const mocks = vi.hoisted(() => ({
  getHarnessFlow: vi.fn(),
  findChatRun: vi.fn(),
  start: vi.fn()
}))

vi.mock('../../../../harness/harness-flow-store', () => ({ getHarnessFlow: mocks.getHarnessFlow }))
vi.mock('../../../../harness/harness-run-registry', () => ({
  getHarnessRunService: () => ({ findChatRun: mocks.findChatRun, start: mocks.start })
}))

const flow = createHarnessTicketFlow(0)

const context: RpcContext = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: harness.start only reads openAgentSessionRecordStore from the runtime.
  runtime: {
    openAgentSessionRecordStore: async () => ({
      getConversation: () => ({ location: { workspaceId: 'repo::/work/ticket' } })
    })
  } as unknown as RpcContext['runtime'],
  caller: { kind: 'local-cli' }
}

function start(params: Record<string, unknown>): Promise<HarnessStartResult> {
  const method = eraseRpcMethods(HARNESS_METHODS).find(
    (entry): entry is RpcMethod & { handler: RpcMethod['handler'] } =>
      entry.name === 'harness.start' && !('stream' in entry)
  )!
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: eraseRpcMethods erases the handler's declared HarnessStartResult.
  return method.handler(params, context) as Promise<HarnessStartResult>
}

function runOf(): HarnessRun {
  return {
    id: 'run-1',
    mode: 'chat',
    chatSessionId: 'chat-1',
    chatTasks: [],
    flowId: flow.id,
    flowName: flow.name,
    flow,
    worktreeId: 'repo::/work/ticket',
    status: 'running',
    vars: {},
    steps: [],
    pending: [],
    error: null,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('harness.start', () => {
  beforeEach(() => {
    mocks.getHarnessFlow.mockReset().mockResolvedValue(flow)
    mocks.findChatRun.mockReset().mockResolvedValue(null)
    mocks.start.mockReset().mockResolvedValue(runOf())
  })

  it('starts a chat-driven run in the caller workspace and returns the protocol', async () => {
    const result = await start({
      sessionId: 'chat-1',
      flowId: flow.id,
      fields: { ticket: 'OP-142', correo: 'dev@example.com' }
    })

    expect(mocks.start).toHaveBeenCalledWith({
      flowId: flow.id,
      worktreeId: 'repo::/work/ticket',
      fields: { ticket: 'OP-142', correo: 'dev@example.com' },
      mode: 'chat',
      chatSessionId: 'chat-1'
    })
    expect(result.instructions).toContain('Ticket automático (Avena PM)')
    expect(result.status.flowName).toBe(flow.name)
  })

  it('refuses missing required start fields', async () => {
    await expect(
      start({ sessionId: 'chat-1', flowId: flow.id, fields: { ticket: 'OP-142' } })
    ).rejects.toThrow(/harness_invalid_start: Falta «correo»/)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('refuses a second flow in a workspace that already drives one', async () => {
    mocks.findChatRun.mockResolvedValue(runOf())
    await expect(
      start({ sessionId: 'chat-1', flowId: flow.id, fields: { ticket: 'OP-1', correo: 'a@b.c' } })
    ).rejects.toThrow(/harness_run_active/)
  })
})
