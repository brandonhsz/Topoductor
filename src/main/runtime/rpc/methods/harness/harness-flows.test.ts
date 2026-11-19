import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods, type RpcContext, type RpcMethod } from '../../core'
import { EMPTY_HARNESS_PROJECT } from '../../../../../shared/harness/harness-flow-normalize'
import type {
  HarnessFlow,
  HarnessFlowScope
} from '../../../../../shared/harness/harness-flow-types'
import type {
  HarnessFlowListItem,
  HarnessFlowReading,
  HarnessFlowSaveResult,
  HarnessFlowVersion
} from '../../../../../shared/harness/harness-flow-version-types'
import { HARNESS_FLOW_METHODS } from './harness-flows'

const store = vi.hoisted(() => ({
  listHarnessFlows: vi.fn(),
  getHarnessFlow: vi.fn(),
  saveHarnessFlow: vi.fn(),
  listHarnessFlowVersions: vi.fn(),
  getHarnessFlowVersion: vi.fn(),
  recordHarnessFlowVersion: vi.fn(),
  listRuns: vi.fn()
}))

vi.mock('../../../../harness/harness-flow-store', () => ({
  listHarnessFlows: store.listHarnessFlows,
  getHarnessFlow: store.getHarnessFlow,
  saveHarnessFlow: store.saveHarnessFlow
}))

vi.mock('../../../../harness/harness-flow-version-store', () => ({
  listHarnessFlowVersions: store.listHarnessFlowVersions,
  getHarnessFlowVersion: store.getHarnessFlowVersion,
  recordHarnessFlowVersion: store.recordHarnessFlowVersion
}))

vi.mock('../../../../harness/harness-run-registry', () => ({
  getHarnessRunService: () => ({ list: store.listRuns })
}))

const at = { x: 0, y: 0 }

function flow(overrides: Partial<HarnessFlow> = {}): HarnessFlow {
  return {
    schemaVersion: 1,
    id: 'f',
    name: 'Entrega',
    description: 'De la idea al PR',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: '',
    project: EMPTY_HARNESS_PROJECT,
    nodes: [
      { kind: 'start', id: 'start', title: 'Inicio', block: '', position: at, fields: [] },
      {
        kind: 'agent',
        id: 'idea',
        title: 'Idea',
        block: '',
        position: at,
        agent: null,
        prompt: '',
        reuseSession: false,
        runner: 'chat',
        allowEdits: false,
        inputs: [],
        outputKey: 'idea',
        joinAll: false,
        maxVisits: 3,
        limitTarget: null
      },
      { kind: 'end', id: 'fin', title: 'Fin', block: '', position: at }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'idea', label: '', when: null },
      { id: 'e2', source: 'idea', target: 'fin', label: '', when: null }
    ],
    updatedAt: 100,
    ...overrides
  }
}

const repoA: HarnessFlowScope = { kind: 'repo', repoId: 'repo-a' }
const callerA = { worktreeId: 'repo-a::/work/a' }

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: harness.flows.* only reads openAgentSessionRecordStore from the runtime.
const context: RpcContext = {
  runtime: {
    openAgentSessionRecordStore: async () => ({
      getConversation: (id: string) =>
        id === 'session-b' ? { location: { workspaceId: 'repo-b::/work/b' } } : null
    })
  } as unknown as RpcContext['runtime'],
  caller: { kind: 'local-cli' }
}

function method(name: string): RpcMethod {
  const found = eraseRpcMethods(HARNESS_FLOW_METHODS).find((entry) => entry.name === name)
  if (!found || 'stream' in found) {
    throw new Error(`missing ${name}`)
  }
  return found
}

const list = (params: object): Promise<HarnessFlowListItem[]> =>
  method('harness.flows.list').handler(params, context) as Promise<HarnessFlowListItem[]>
const get = (params: object): Promise<HarnessFlowReading> =>
  method('harness.flows.get').handler(params, context) as Promise<HarnessFlowReading>
const save = (params: object): Promise<HarnessFlowSaveResult> =>
  method('harness.flows.save').handler(params, context) as Promise<HarnessFlowSaveResult>

function versionOf(content: HarnessFlow): HarnessFlowVersion {
  return {
    id: 'v1',
    flowId: content.id,
    createdAt: 1,
    author: 'person',
    summary: 'Guardado',
    flow: content
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.listHarnessFlows.mockImplementation(async (repoId: string | null) =>
    repoId === 'repo-b'
      ? [flow({ id: 'override-b', name: 'Copia B', scope: { kind: 'repo', repoId: 'repo-b' } })]
      : [flow()]
  )
  store.listRuns.mockResolvedValue([])
  store.listHarnessFlowVersions.mockResolvedValue([])
  store.getHarnessFlowVersion.mockResolvedValue(null)
  store.saveHarnessFlow.mockImplementation(async (raw: HarnessFlow) => ({ ...raw, updatedAt: 999 }))
  store.recordHarnessFlowVersion.mockImplementation(
    async (input: { flow: HarnessFlow; author: string; summary: string }) => ({
      id: `version-${input.author}`,
      flowId: input.flow.id,
      createdAt: 5,
      author: input.author,
      summary: input.summary
    })
  )
})

describe('caller repo', () => {
  it('lists the flows of the repo named by worktreeId', async () => {
    const items = await list({ worktreeId: 'repo-b::/work/b' })
    expect(store.listHarnessFlows).toHaveBeenCalledWith('repo-b')
    expect(items).toEqual([
      {
        id: 'override-b',
        name: 'Copia B',
        description: 'De la idea al PR',
        scope: { kind: 'repo', repoId: 'repo-b' },
        basedOnFlowId: null,
        updatedAt: 100,
        nodeCount: 3
      }
    ])
  })

  it('resolves the repo of a chat from its session record', async () => {
    const items = await list({ sessionId: 'session-b' })
    expect(items.map((item) => item.id)).toEqual(['override-b'])
  })

  it('rejects a caller with neither worktree nor session', async () => {
    await expect(list({})).rejects.toThrow(/harness_no_workspace/)
  })
})

describe('harness.flows.get', () => {
  it('returns markdown, problems, active runs and the global reach', async () => {
    store.getHarnessFlow.mockResolvedValue(flow())
    store.listRuns.mockResolvedValue([
      { flowId: 'f', status: 'running' },
      { flowId: 'f', status: 'waiting' },
      { flowId: 'f', status: 'completed' },
      { flowId: 'otro', status: 'running' }
    ])
    const reading = await get({ ...callerA, flowId: 'f' })
    expect(store.getHarnessFlow).toHaveBeenCalledWith('f')
    expect(reading.flow.id).toBe('f')
    expect(reading.markdown).toContain('flowchart TD')
    expect(reading.markdown).toContain('Idea')
    expect(reading.problems).toEqual(['«Idea» no tiene prompt.'])
    expect(reading.activeRuns).toBe(2)
    expect(reading.affectsAllRepos).toBe(true)
  })

  it('reads a copy of the caller repo as not reaching other repos', async () => {
    store.getHarnessFlow.mockResolvedValue(flow({ scope: repoA }))
    const reading = await get({ ...callerA, flowId: 'f' })
    expect(reading.affectsAllRepos).toBe(false)
  })

  it('reports a missing flow', async () => {
    store.getHarnessFlow.mockResolvedValue(null)
    await expect(get({ ...callerA, flowId: 'nope' })).rejects.toThrow(/harness_flow_not_found/)
  })

  it('refuses a copy that belongs to another repo', async () => {
    store.getHarnessFlow.mockResolvedValue(flow({ scope: { kind: 'repo', repoId: 'repo-b' } }))
    await expect(get({ ...callerA, flowId: 'f' })).rejects.toThrow(/harness_flow_scope_forbidden/)
  })
})

describe('harness.flows.save', () => {
  const order = (): string[] =>
    [
      ...store.recordHarnessFlowVersion.mock.calls.map(
        (call, index) =>
          [
            store.recordHarnessFlowVersion.mock.invocationCallOrder[index],
            `version:${(call[0] as { author: string }).author}`
          ] as const
      ),
      ...store.saveHarnessFlow.mock.invocationCallOrder.map((n) => [n, 'save'] as const)
    ]
      .sort((left, right) => left[0] - right[0])
      .map(([, label]) => label)

  it('versions the unversioned stored state before writing the agent change', async () => {
    const stored = flow({ updatedAt: 100 })
    store.getHarnessFlow.mockResolvedValue(stored)
    store.listHarnessFlowVersions.mockResolvedValue([])
    const edited = { ...stored, name: 'Entrega rápida' }

    const result = await save({
      ...callerA,
      flow: edited,
      summary: 'Renombra el flujo',
      expectedUpdatedAt: 100
    })

    expect(order()).toEqual(['version:person', 'save', 'version:agent'])
    const [before, after] = store.recordHarnessFlowVersion.mock.calls.map((call) => call[0])
    expect(before.flow).toEqual(stored)
    expect(before.summary).toContain('Antes del cambio del agente')
    expect(store.saveHarnessFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f', name: 'Entrega rápida' }),
      { expectedUpdatedAt: 100, source: 'agent', summary: 'Renombra el flujo' }
    )
    expect(after).toEqual({
      flow: expect.objectContaining({ name: 'Entrega rápida', updatedAt: 999 }),
      author: 'agent',
      summary: 'Renombra el flujo'
    })
    expect(result.version.id).toBe('version-agent')
    expect(result.reading.flow.updatedAt).toBe(999)
    expect(result.reading.affectsAllRepos).toBe(true)
  })

  it('versions the stored state when it drifted from the latest version', async () => {
    const stored = flow({ name: 'Editado a mano' })
    store.getHarnessFlow.mockResolvedValue(stored)
    store.listHarnessFlowVersions.mockResolvedValue([
      { id: 'v1', flowId: 'f', createdAt: 1, author: 'person', summary: 'Guardado' }
    ])
    store.getHarnessFlowVersion.mockResolvedValue(versionOf(flow({ name: 'Entrega' })))

    await save({ ...callerA, flow: stored, summary: 'Ajuste' })

    expect(order()).toEqual(['version:person', 'save', 'version:agent'])
  })

  // Assumption: "matches the latest version" compares flow content and ignores updatedAt,
  // because every write stamps a new updatedAt even when nothing else changed.
  it('skips the person version when the stored state already is the latest version', async () => {
    store.getHarnessFlow.mockResolvedValue(flow({ updatedAt: 500 }))
    store.listHarnessFlowVersions.mockResolvedValue([
      { id: 'v1', flowId: 'f', createdAt: 1, author: 'agent', summary: 'Anterior' }
    ])
    store.getHarnessFlowVersion.mockResolvedValue(versionOf(flow({ updatedAt: 300 })))

    await save({ ...callerA, flow: flow({ name: 'Otro' }), summary: 'Ajuste' })

    expect(store.getHarnessFlowVersion).toHaveBeenCalledWith('f', 'v1')
    expect(order()).toEqual(['save', 'version:agent'])
  })

  it('refuses to overwrite a copy of another repo', async () => {
    store.getHarnessFlow.mockResolvedValue(flow({ scope: { kind: 'repo', repoId: 'repo-b' } }))
    await expect(save({ ...callerA, flow: flow(), summary: 'Ajuste' })).rejects.toThrow(
      /harness_flow_scope_forbidden/
    )
    expect(store.saveHarnessFlow).not.toHaveBeenCalled()
    expect(store.recordHarnessFlowVersion).not.toHaveBeenCalled()
  })

  it('creates an unknown flow as a copy of the caller repo under a new id', async () => {
    store.getHarnessFlow.mockResolvedValue(null)

    const result = await save({
      ...callerA,
      flow: flow({ id: 'inventado' }),
      summary: 'Flujo nuevo'
    })

    const written = store.saveHarnessFlow.mock.calls[0][0] as HarnessFlow
    expect(written.id).not.toBe('inventado')
    expect(written.id.length).toBeGreaterThan(0)
    expect(written.scope).toEqual(repoA)
    expect(order()).toEqual(['save', 'version:agent'])
    expect(result.reading.affectsAllRepos).toBe(false)
  })

  it('creates a global flow when asked, generating the missing id', async () => {
    store.getHarnessFlow.mockResolvedValue(null)
    const { id: _omitted, ...withoutId } = flow({ scope: repoA })

    await save({ ...callerA, flow: withoutId, summary: 'Flujo global', scope: 'global' })

    const written = store.saveHarnessFlow.mock.calls[0][0] as HarnessFlow
    expect(written.id).toEqual(expect.any(String))
    expect(written.id.length).toBeGreaterThan(0)
    expect(written.scope).toEqual({ kind: 'global' })
  })

  it('propagates a write conflict without recording an agent version', async () => {
    store.getHarnessFlow.mockResolvedValue(flow())
    store.listHarnessFlowVersions.mockResolvedValue([
      { id: 'v1', flowId: 'f', createdAt: 1, author: 'person', summary: 'Guardado' }
    ])
    store.getHarnessFlowVersion.mockResolvedValue(versionOf(flow()))
    store.saveHarnessFlow.mockRejectedValue(new Error('harness_flow_conflict: changed meanwhile'))

    await expect(
      save({ ...callerA, flow: flow(), summary: 'Ajuste', expectedUpdatedAt: 1 })
    ).rejects.toThrow(/harness_flow_conflict/)
    expect(store.recordHarnessFlowVersion).not.toHaveBeenCalled()
  })
})
