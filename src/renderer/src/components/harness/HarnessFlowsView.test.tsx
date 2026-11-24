// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessFlow } from '../../../../shared/harness/harness-flow-types'
import type {
  HarnessFlowChange,
  HarnessFlowVersion,
  HarnessFlowVersionSummary
} from '../../../../shared/harness/harness-flow-version-types'
import type { HarnessApi } from '../../../../shared/harness/harness-run-types'
import { createEmptyHarnessFlow } from './harness-flow-editing'
import { HarnessFlowsView } from './HarnessFlowsView'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key) => values?.[key] ?? '')
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ openModal: vi.fn() }) } }))
// React Flow needs real layout; the stub shows the flow it gets and whether it may edit it.
vi.mock('./HarnessFlowCanvas', () => ({
  HarnessFlowCanvas: ({
    flow,
    editable,
    onFlowChange
  }: {
    flow: HarnessFlow
    editable: boolean
    onFlowChange?: (flow: HarnessFlow) => void
  }) => (
    <section aria-label="Canvas">
      <h2>{flow.name}</h2>
      <button
        type="button"
        disabled={!editable}
        onClick={() => onFlowChange?.({ ...flow, name: `${flow.name} (mine)` })}
      >
        Rename in canvas
      </button>
    </section>
  )
}))
vi.mock('./HarnessInspector', () => ({ HarnessInspector: () => null }))

function flow(id: string, name: string): HarnessFlow {
  return {
    ...createEmptyHarnessFlow({ name, start: 'Start', intent: 'Intent', end: 'End' }),
    id
  }
}

const versions: HarnessFlowVersionSummary[] = [
  { id: 'v3', flowId: 'flow-1', createdAt: 3, author: 'agent', summary: 'Added a review node' },
  { id: 'v2', flowId: 'flow-1', createdAt: 2, author: 'person', summary: 'Renamed the plan step' },
  { id: 'v1', flowId: 'flow-1', createdAt: 1, author: 'person', summary: 'First draft' }
]

function snapshot(versionId: string, name: string): HarnessFlowVersion {
  const summary = versions.find((version) => version.id === versionId)
  if (!summary) {
    throw new Error(`no version ${versionId}`)
  }
  return { ...summary, flow: flow('flow-1', name) }
}

type FakeHarness = Pick<
  HarnessApi,
  | 'listFlows'
  | 'saveFlow'
  | 'deleteFlow'
  | 'listFlowVersions'
  | 'getFlowVersion'
  | 'saveFlowVersion'
  | 'restoreFlowVersion'
  | 'onFlowsChanged'
>

let stored: HarnessFlow[]
let listeners: ((change: HarnessFlowChange | null) => void)[]
let harness: {
  [Key in keyof FakeHarness]: ReturnType<typeof vi.fn<FakeHarness[Key]>>
}

beforeEach(() => {
  vi.useFakeTimers()
  stored = [flow('flow-1', 'Review flow'), flow('flow-2', 'Release flow')]
  listeners = []
  harness = {
    listFlows: vi.fn<FakeHarness['listFlows']>(async () => stored),
    saveFlow: vi.fn<FakeHarness['saveFlow']>(async (saved) => saved),
    deleteFlow: vi.fn<FakeHarness['deleteFlow']>(async () => {}),
    listFlowVersions: vi.fn<FakeHarness['listFlowVersions']>(async (flowId) =>
      versions.filter((version) => version.flowId === flowId)
    ),
    getFlowVersion: vi.fn<FakeHarness['getFlowVersion']>(async (_flowId, versionId) =>
      snapshot(versionId, `Flow as of ${versionId}`)
    ),
    saveFlowVersion: vi.fn<FakeHarness['saveFlowVersion']>(async (flowId, summary) => ({
      id: 'v4',
      flowId,
      createdAt: 4,
      author: 'person',
      summary
    })),
    restoreFlowVersion: vi.fn<FakeHarness['restoreFlowVersion']>(async () => stored[0]),
    onFlowsChanged: vi.fn<FakeHarness['onFlowsChanged']>((callback) => {
      listeners.push(callback)
      return () => {
        listeners = listeners.filter((listener) => listener !== callback)
      }
    })
  }
  vi.stubGlobal('api', { harness })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function settle(ms = 0): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

async function openEditor(): Promise<void> {
  render(<HarnessFlowsView workspace={{ worktreeId: 'wt', repoId: null, name: 'repo' }} />)
  await settle()
}

async function emit(change: HarnessFlowChange): Promise<void> {
  await act(async () => {
    for (const listener of listeners) {
      listener(change)
    }
  })
  await settle()
}

function agentChange(flowId: string): HarnessFlowChange {
  return { flowId, kind: 'saved', source: 'agent', summary: 'Split review in two', updatedAt: 9 }
}

function canvas(): HTMLElement {
  return screen.getByRole('region', { name: 'Canvas' })
}

function versionButton(summary: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Versions' })
  return within(list).getByRole('button', { name: new RegExp(summary) })
}

async function editInCanvas(): Promise<void> {
  fireEvent.click(within(canvas()).getByRole('button', { name: 'Rename in canvas' }))
  await settle()
}

describe('HarnessFlowsView versions', () => {
  it('lists the saved versions of the open flow', async () => {
    await openEditor()

    expect(harness.listFlowVersions).toHaveBeenCalledWith('flow-1')
    const list = screen.getByRole('list', { name: 'Versions' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('Renamed the plan step')).toBeInTheDocument()
  })

  it('saves a version with the typed summary and lists it', async () => {
    await openEditor()
    harness.listFlowVersions.mockImplementation(async (flowId) => [
      { id: 'v4', flowId, createdAt: 4, author: 'person', summary: 'Tighter review' },
      ...versions
    ])

    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: 'Tighter review' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await settle()

    expect(harness.saveFlowVersion).toHaveBeenCalledWith('flow-1', 'Tighter review')
    expect(versionButton('Tighter review')).toBeInTheDocument()
  })

  it('stores pending edits before saving a version of them', async () => {
    await openEditor()
    await editInCanvas()

    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: 'Renamed' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await settle()

    expect(harness.saveFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'flow-1', name: 'Review flow (mine)' })
    )
    const [savedAt] = harness.saveFlow.mock.invocationCallOrder
    const [versionedAt] = harness.saveFlowVersion.mock.invocationCallOrder
    expect(savedAt).toBeLessThan(versionedAt)
  })

  it('previews a version read-only and goes back to the current flow', async () => {
    await openEditor()

    fireEvent.click(versionButton('Renamed the plan step'))
    await settle()
    expect(harness.getFlowVersion).toHaveBeenCalledWith('flow-1', 'v2')
    expect(within(canvas()).getByRole('heading', { name: 'Flow as of v2' })).toBeInTheDocument()
    expect(within(canvas()).getByRole('button', { name: 'Rename in canvas' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    await settle()
    expect(harness.getFlowVersion).toHaveBeenLastCalledWith('flow-1', 'v1')
    expect(within(canvas()).getByRole('heading', { name: 'Flow as of v1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to current' }))
    await settle()
    expect(within(canvas()).getByRole('heading', { name: 'Review flow' })).toBeInTheDocument()
    expect(within(canvas()).getByRole('button', { name: 'Rename in canvas' })).toBeEnabled()
  })

  it('restores the previewed version and edits it as the current flow', async () => {
    await openEditor()
    fireEvent.click(versionButton('First draft'))
    await settle()
    harness.restoreFlowVersion.mockImplementation(async () => {
      stored = [flow('flow-1', 'Restored draft'), stored[1]]
      return stored[0]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await settle()
    await emit({
      flowId: 'flow-1',
      kind: 'restored',
      source: 'person',
      summary: 'First draft',
      updatedAt: 10
    })

    expect(harness.restoreFlowVersion).toHaveBeenCalledWith('flow-1', 'v1')
    expect(within(canvas()).getByRole('heading', { name: 'Restored draft' })).toBeInTheDocument()
    expect(within(canvas()).getByRole('button', { name: 'Rename in canvas' })).toBeEnabled()
  })
})

describe('HarnessFlowsView current version', () => {
  it('moves Current to a version the agent records after a restore', async () => {
    await openEditor()
    fireEvent.click(versionButton('First draft'))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await settle()
    expect(versionButton('First draft')).toHaveTextContent('Current')

    const agentVersion: HarnessFlowVersionSummary = {
      id: 'v5',
      flowId: 'flow-1',
      createdAt: 5,
      author: 'agent',
      summary: 'Agent tweak'
    }
    harness.listFlowVersions.mockImplementation(async () => [agentVersion, ...versions])
    await emit(agentChange('flow-1'))

    expect(versionButton('Agent tweak')).toHaveTextContent('Current')
    expect(versionButton('First draft')).not.toHaveTextContent('Current')
  })

  it('does not offer to save a version while previewing an older one', async () => {
    await openEditor()
    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: 'Snapshot' }
    })
    expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled()

    fireEvent.click(versionButton('First draft'))
    await settle()

    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled()
  })
})

describe('HarnessFlowsView agent changes', () => {
  async function editThenAgentChanges(): Promise<void> {
    await openEditor()
    await editInCanvas()
    stored = [flow('flow-1', 'Agent flow'), stored[1]]
    await emit(agentChange('flow-1'))
  }

  it('asks before touching unsaved edits and holds the autosave meanwhile', async () => {
    await editThenAgentChanges()

    expect(screen.getByText('The agent changed this flow')).toBeInTheDocument()
    expect(screen.getByText('Split review in two')).toBeInTheDocument()
    await settle(2_000)
    expect(harness.saveFlow).not.toHaveBeenCalled()
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
    expect(screen.getByText('Not saved yet')).toBeInTheDocument()
    expect(
      within(canvas()).getByRole('heading', { name: 'Review flow (mine)' })
    ).toBeInTheDocument()
  })

  it("drops the local edits to show the agent's version", async () => {
    await editThenAgentChanges()

    fireEvent.click(screen.getByRole('button', { name: "Show the agent's version" }))
    await settle(2_000)

    expect(within(canvas()).getByRole('heading', { name: 'Agent flow' })).toBeInTheDocument()
    expect(screen.queryByText('The agent changed this flow')).not.toBeInTheDocument()
    expect(harness.saveFlow).not.toHaveBeenCalled()
  })

  it('keeps the local edits by saving them over the agent change', async () => {
    await editThenAgentChanges()

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    await settle(2_000)

    expect(harness.saveFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'flow-1', name: 'Review flow (mine)' })
    )
    expect(
      within(canvas()).getByRole('heading', { name: 'Review flow (mine)' })
    ).toBeInTheDocument()
    expect(screen.queryByText('The agent changed this flow')).not.toBeInTheDocument()
  })

  it('reloads an agent change without asking when nothing is unsaved', async () => {
    await openEditor()
    stored = [flow('flow-1', 'Agent flow'), stored[1]]

    await emit(agentChange('flow-1'))

    expect(within(canvas()).getByRole('heading', { name: 'Agent flow' })).toBeInTheDocument()
    expect(screen.queryByText('The agent changed this flow')).not.toBeInTheDocument()
  })

  it('treats edits the autosave already stored as nothing unsaved', async () => {
    await openEditor()
    await editInCanvas()
    await settle(600)
    expect(harness.saveFlow).toHaveBeenCalledTimes(1)
    stored = [flow('flow-1', 'Agent flow'), stored[1]]

    await emit(agentChange('flow-1'))

    expect(within(canvas()).getByRole('heading', { name: 'Agent flow' })).toBeInTheDocument()
    expect(screen.queryByText('The agent changed this flow')).not.toBeInTheDocument()
  })
})
