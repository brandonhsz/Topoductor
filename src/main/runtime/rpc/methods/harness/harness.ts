import { defineMethod } from '../../core'
import {
  HarnessAnswerParams,
  HarnessCompleteParams,
  HarnessGuardParams,
  HarnessStatusParams,
  HarnessSubagentResultParams,
  HarnessWaitParams
} from '../../../../../shared/rpc-contract/harness-params'
import {
  harnessChatStatus,
  type HarnessChatStatus
} from '../../../../../shared/harness/harness-chat-status'
import type { HarnessRun } from '../../../../../shared/harness/harness-run-types'
import type { HarnessSubagentResult } from '../../../../../shared/harness/harness-subagent-contract'
import { harnessEditDenial } from '../../../../harness/harness-edit-guard'
import {
  getHarnessRunService,
  type HarnessChatRuns
} from '../../../../harness/harness-run-registry'
import type { TopoRuntimeService } from '../../../topo-runtime'

const DEFAULT_WAIT_MS = 5 * 60 * 1000

function requireService(): HarnessChatRuns {
  const service = getHarnessRunService()
  if (!service) {
    throw new Error('harness_unavailable')
  }
  return service
}

/** Chats carry only a session id; their workspace comes from the session record. */
async function sessionWorkspace(
  runtime: TopoRuntimeService,
  sessionId: string | undefined
): Promise<string | null> {
  if (!sessionId) {
    return null
  }
  try {
    const store = await runtime.openAgentSessionRecordStore()
    return store.getConversation(sessionId)?.location.workspaceId ?? null
  } catch {
    return null
  }
}

async function callerRun(
  runtime: TopoRuntimeService,
  params: { sessionId?: string; worktreeId?: string }
): Promise<{ service: HarnessChatRuns; run: HarnessRun }> {
  const service = requireService()
  const worktreeId = params.worktreeId ?? (await sessionWorkspace(runtime, params.sessionId))
  const run = await service.findChatRun({ sessionId: params.sessionId ?? null, worktreeId })
  if (!run) {
    throw new Error('harness_no_run: no chat-driven Harness flow is running for this workspace')
  }
  if (params.sessionId) {
    service.bindChatSession(run.id, params.sessionId)
  }
  return { service, run }
}

function hasWorkForChat(run: HarnessRun): boolean {
  return (
    run.chatTasks.length > 0 ||
    run.pending.length > 0 ||
    (run.status !== 'running' && run.status !== 'waiting')
  )
}

export const HARNESS_METHODS = [
  defineMethod({
    name: 'harness.guard',
    permission: 'workspace',
    params: HarnessGuardParams,
    handler: async (params, { runtime }): Promise<{ reason: string | null }> => {
      const worktreeId = params.worktreeId ?? (await sessionWorkspace(runtime, params.sessionId))
      return {
        reason: harnessEditDenial(params.tool, { sessionId: params.sessionId ?? null, worktreeId })
      }
    }
  }),
  defineMethod({
    name: 'harness.status',
    permission: 'workspace',
    params: HarnessStatusParams,
    handler: async (params, { runtime }): Promise<HarnessChatStatus> =>
      harnessChatStatus((await callerRun(runtime, params)).run)
  }),
  defineMethod({
    name: 'harness.complete',
    permission: 'workspace',
    params: HarnessCompleteParams,
    handler: async (params, { runtime }): Promise<HarnessChatStatus> => {
      const { service, run } = await callerRun(runtime, params)
      const task = run.chatTasks.find((entry) => entry.id === params.taskId)
      if (task?.delivery === 'subagent') {
        throw new Error(
          `harness_subagent_required: ${params.taskId} completes when you launch its subagent with the exact prompt`
        )
      }
      const accepted = service.completeChat(run.id, {
        taskId: params.taskId,
        output: params.output,
        outcome: params.outcome ?? null
      })
      if (!accepted) {
        throw new Error(`harness_unknown_task: ${params.taskId} is not an open task of this flow`)
      }
      return harnessChatStatus(run)
    }
  }),
  defineMethod({
    name: 'harness.wait',
    permission: 'workspace',
    params: HarnessWaitParams,
    handler: async (params, { runtime }): Promise<HarnessChatStatus> => {
      const { service, run } = await callerRun(runtime, params)
      const deadline = Date.now() + (params.timeoutMs ?? DEFAULT_WAIT_MS)
      let current: HarnessRun | null = run
      while (current && !hasWorkForChat(current) && Date.now() < deadline) {
        current = await service.waitForChange(run.id, deadline - Date.now())
      }
      return harnessChatStatus(current ?? run)
    }
  }),
  defineMethod({
    name: 'harness.answer',
    permission: 'workspace',
    params: HarnessAnswerParams,
    handler: async (params, { runtime }): Promise<HarnessChatStatus> => {
      const { service, run } = await callerRun(runtime, params)
      if (!run.pending.some((decision) => decision.id === params.decisionId)) {
        throw new Error(`harness_unknown_decision: ${params.decisionId} is not pending`)
      }
      service.answer(run.id, {
        decisionId: params.decisionId,
        choice: params.choice ?? null,
        text: params.text ?? '',
        fields: params.fields ?? {}
      })
      return harnessChatStatus(run)
    }
  }),
  defineMethod({
    name: 'harness.subagentResult',
    permission: 'workspace',
    params: HarnessSubagentResultParams,
    handler: async (params, { runtime }): Promise<HarnessSubagentResult> => {
      const { service, run } = await callerRun(runtime, params)
      return service.completeSubagent(run.id, params.prompt, params.output)
    }
  })
]
