import { randomUUID } from 'node:crypto'
import { defineMethod } from '../../core'
import {
  HarnessFlowsGetParams,
  HarnessFlowsListParams,
  HarnessFlowsSaveParams
} from '../../../../../shared/rpc-contract/harness-flow-params'
import type {
  HarnessFlow,
  HarnessFlowScope
} from '../../../../../shared/harness/harness-flow-types'
import type {
  HarnessFlowListItem,
  HarnessFlowReading,
  HarnessFlowSaveResult
} from '../../../../../shared/harness/harness-flow-version-types'
import { harnessFlowToMarkdown } from '../../../../../shared/harness/harness-flow-markdown'
import { harnessFlowProblems } from '../../../../../shared/harness/harness-flow-problems'
import { splitWorktreeId } from '../../../../../shared/worktree/id'
import {
  getHarnessFlow,
  listHarnessFlows,
  saveHarnessFlow
} from '../../../../harness/harness-flow-store'
import {
  getHarnessFlowVersion,
  listHarnessFlowVersions,
  recordHarnessFlowVersion
} from '../../../../harness/harness-flow-version-store'
import { getHarnessRunService } from '../../../../harness/harness-run-registry'
import type { TopoRuntimeService } from '../../../topo-runtime'
import { callerWorkspace } from './harness-caller-workspace'
import { HarnessFlowError } from '../../../../../shared/harness/harness-flow-errors'

const BEFORE_AGENT_SUMMARY = 'Before the agent change'

async function callerRepo(
  runtime: TopoRuntimeService,
  params: { sessionId?: string; worktreeId?: string }
): Promise<string | null> {
  const worktreeId = await callerWorkspace(runtime, params)
  if (!worktreeId) {
    throw new HarnessFlowError(
      'harness_no_workspace',
      'run inside a Topo workspace or pass --worktree'
    )
  }
  return splitWorktreeId(worktreeId)?.repoId || null
}

/** A repo copy is only reachable from its own repo. */
function assertReachable(flow: HarnessFlow, repoId: string | null): void {
  if (flow.scope.kind === 'repo' && flow.scope.repoId !== repoId) {
    throw new HarnessFlowError('harness_flow_scope_forbidden', `${flow.id} belongs to another repo`)
  }
}

async function activeRuns(flowId: string): Promise<number> {
  const runs = (await getHarnessRunService()?.list()) ?? []
  return runs.filter(
    (run) => run.flowId === flowId && (run.status === 'running' || run.status === 'waiting')
  ).length
}

async function readingOf(flow: HarnessFlow): Promise<HarnessFlowReading> {
  return {
    flow,
    markdown: harnessFlowToMarkdown(flow),
    problems: harnessFlowProblems(flow),
    activeRuns: await activeRuns(flow.id),
    affectsAllRepos: flow.scope.kind === 'global'
  }
}

/** Every write stamps a new `updatedAt`, so content equality ignores it. */
function sameContent(left: HarnessFlow, right: HarnessFlow): boolean {
  return JSON.stringify({ ...left, updatedAt: 0 }) === JSON.stringify({ ...right, updatedAt: 0 })
}

/** Keeps the person's last state recoverable before an agent overwrites it. */
async function versionUnversionedState(stored: HarnessFlow): Promise<void> {
  const [latest] = await listHarnessFlowVersions(stored.id)
  const latestFlow = latest ? (await getHarnessFlowVersion(stored.id, latest.id))?.flow : null
  if (latestFlow && sameContent(latestFlow, stored)) {
    return
  }
  await recordHarnessFlowVersion({ flow: stored, author: 'person', summary: BEFORE_AGENT_SUMMARY })
}

function newFlowScope(
  requested: 'global' | 'repo' | undefined,
  repoId: string | null
): HarnessFlowScope {
  if (requested === 'global' || (!requested && !repoId)) {
    return { kind: 'global' }
  }
  if (!repoId) {
    throw new HarnessFlowError(
      'harness_flow_scope_forbidden',
      'this workspace has no repo for a repo flow'
    )
  }
  return { kind: 'repo', repoId }
}

export const HARNESS_FLOW_METHODS = [
  defineMethod({
    name: 'harness.flows.list',
    permission: 'workspace',
    params: HarnessFlowsListParams,
    handler: async (params, { runtime }): Promise<HarnessFlowListItem[]> => {
      const flows = await listHarnessFlows(await callerRepo(runtime, params))
      return flows.map((flow) => ({
        id: flow.id,
        name: flow.name,
        description: flow.description,
        scope: flow.scope,
        basedOnFlowId: flow.basedOnFlowId,
        updatedAt: flow.updatedAt,
        nodeCount: flow.nodes.length
      }))
    }
  }),
  defineMethod({
    name: 'harness.flows.get',
    permission: 'workspace',
    params: HarnessFlowsGetParams,
    handler: async (params, { runtime }): Promise<HarnessFlowReading> => {
      const repoId = await callerRepo(runtime, params)
      const flow = await getHarnessFlow(params.flowId)
      if (!flow) {
        throw new HarnessFlowError('harness_flow_not_found', `${params.flowId}`)
      }
      assertReachable(flow, repoId)
      return readingOf(flow)
    }
  }),
  defineMethod({
    name: 'harness.flows.save',
    permission: 'workspace',
    params: HarnessFlowsSaveParams,
    handler: async (params, { runtime }): Promise<HarnessFlowSaveResult> => {
      const repoId = await callerRepo(runtime, params)
      const requestedId = typeof params.flow.id === 'string' ? params.flow.id : null
      const stored = requestedId ? await getHarnessFlow(requestedId) : null
      let next: Record<string, unknown>
      if (stored) {
        assertReachable(stored, repoId)
        await versionUnversionedState(stored)
        // Where a flow lives is not the agent's to change.
        next = {
          ...params.flow,
          id: stored.id,
          scope: stored.scope,
          basedOnFlowId: stored.basedOnFlowId
        }
      } else {
        next = {
          ...params.flow,
          id: `flow-${randomUUID().slice(0, 8)}`,
          scope: newFlowScope(params.scope, repoId),
          basedOnFlowId: null
        }
      }
      const expected = stored ? params.expectedUpdatedAt : undefined
      const saved = await saveHarnessFlow(next, {
        ...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
        source: 'agent',
        summary: params.summary
      })
      const version = await recordHarnessFlowVersion({
        flow: saved,
        author: 'agent',
        summary: params.summary
      })
      return { reading: await readingOf(saved), version }
    }
  })
]
