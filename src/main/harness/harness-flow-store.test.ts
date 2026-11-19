import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarnessExampleFlow } from '../../shared/harness/harness-example-flow'
import type { HarnessFlow, HarnessFlowScope } from '../../shared/harness/harness-flow-types'
import type { HarnessFlowChange } from '../../shared/harness/harness-flow-version-types'
import {
  deleteHarnessFlow,
  getHarnessFlow,
  onHarnessFlowsChanged,
  restoreHarnessFlowVersion,
  saveHarnessFlow
} from './harness-flow-store'
import { listHarnessFlowVersions, recordHarnessFlowVersion } from './harness-flow-version-store'

const env = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => env.userData })
}))

const REPO_SCOPE: HarnessFlowScope = { kind: 'repo', repoId: 'repo-1' }

function flow(name: string, scope: HarnessFlowScope = REPO_SCOPE): HarnessFlow {
  return { ...createHarnessExampleFlow(0), id: 'mi-flujo', name, scope }
}

let unsubscribe: (() => void) | null = null

function captureChanges(): HarnessFlowChange[] {
  const changes: HarnessFlowChange[] = []
  unsubscribe = onHarnessFlowsChanged((change) => changes.push(change))
  return changes
}

beforeEach(() => {
  env.userData = mkdtempSync(join(tmpdir(), 'topo-harness-flows-'))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1000)
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.useRealTimers()
  rmSync(env.userData, { recursive: true, force: true })
})

describe('saveHarnessFlow expectedUpdatedAt', () => {
  it('rejects a stale expectedUpdatedAt without writing', async () => {
    await saveHarnessFlow(flow('original'))
    vi.setSystemTime(2000)

    await expect(saveHarnessFlow(flow('pisado'), { expectedUpdatedAt: 999 })).rejects.toThrow(
      'harness_flow_conflict'
    )

    const stored = await getHarnessFlow('mi-flujo')
    expect(stored?.name).toBe('original')
    expect(stored?.updatedAt).toBe(1000)
  })

  it('writes when expectedUpdatedAt matches the stored flow', async () => {
    await saveHarnessFlow(flow('original'))
    vi.setSystemTime(2000)

    await saveHarnessFlow(flow('nuevo'), { expectedUpdatedAt: 1000 })

    const stored = await getHarnessFlow('mi-flujo')
    expect(stored?.name).toBe('nuevo')
    expect(stored?.updatedAt).toBe(2000)
  })
})

describe('onHarnessFlowsChanged', () => {
  it('emits saved changes with their source and summary until unsubscribed', async () => {
    const changes = captureChanges()

    await saveHarnessFlow(flow('agente'), { source: 'agent', summary: 'Agrega revisión' })
    vi.setSystemTime(2000)
    await saveHarnessFlow(flow('persona'))
    unsubscribe?.()
    await saveHarnessFlow(flow('ya no escucha'))

    expect(changes).toEqual([
      {
        flowId: 'mi-flujo',
        kind: 'saved',
        source: 'agent',
        summary: 'Agrega revisión',
        updatedAt: 1000
      },
      { flowId: 'mi-flujo', kind: 'saved', source: 'person', summary: '', updatedAt: 2000 }
    ])
  })

  it('emits a deleted change with a null updatedAt', async () => {
    await saveHarnessFlow(flow('original'))
    const changes = captureChanges()

    await deleteHarnessFlow('mi-flujo')

    expect(changes).toEqual([
      expect.objectContaining({ flowId: 'mi-flujo', kind: 'deleted', updatedAt: null })
    ])
  })
})

describe('restoreHarnessFlowVersion', () => {
  it('makes the version current, keeping the flow scope and every later version', async () => {
    await saveHarnessFlow(flow('uno'))
    const first = await recordHarnessFlowVersion({
      flow: flow('uno', { kind: 'global' }),
      author: 'person',
      summary: 'Primera'
    })
    vi.setSystemTime(2000)
    await saveHarnessFlow(flow('dos'))
    await recordHarnessFlowVersion({ flow: flow('dos'), author: 'agent', summary: 'Segunda' })
    const changes = captureChanges()
    vi.setSystemTime(3000)

    const restored = await restoreHarnessFlowVersion('mi-flujo', first.id)

    const stored = await getHarnessFlow('mi-flujo')
    expect(restored.name).toBe('uno')
    expect(stored?.id).toBe('mi-flujo')
    expect(stored?.name).toBe('uno')
    expect(stored?.scope).toEqual(REPO_SCOPE)
    expect(stored?.updatedAt).toBe(3000)
    expect((await listHarnessFlowVersions('mi-flujo')).map((v) => v.summary)).toEqual([
      'Segunda',
      'Primera'
    ])
    expect(changes).toEqual([
      expect.objectContaining({ flowId: 'mi-flujo', kind: 'restored', updatedAt: 3000 })
    ])
  })

  it('rejects an unknown version and leaves the flow untouched', async () => {
    await saveHarnessFlow(flow('original'))

    await expect(restoreHarnessFlowVersion('mi-flujo', 'no-existe')).rejects.toThrow(
      'harness_flow_version_not_found'
    )

    expect((await getHarnessFlow('mi-flujo'))?.name).toBe('original')
  })
})

describe('flow history lifecycle', () => {
  it('deleting a flow also deletes its version history', async () => {
    await saveHarnessFlow(flow('original'))
    await recordHarnessFlowVersion({ flow: flow('original'), author: 'person', summary: 'Base' })

    await deleteHarnessFlow('mi-flujo')

    expect(await listHarnessFlowVersions('mi-flujo')).toEqual([])
  })

  it('autosaving does not create versions', async () => {
    await saveHarnessFlow(flow('uno'))
    await saveHarnessFlow(flow('dos'), { source: 'agent', summary: 'Cambio del agente' })

    expect(await listHarnessFlowVersions('mi-flujo')).toEqual([])
  })
})
