import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarnessExampleFlow } from '../../shared/harness/harness-example-flow'
import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import {
  deleteHarnessFlowVersions,
  getHarnessFlowVersion,
  listHarnessFlowVersions,
  recordHarnessFlowVersion
} from './harness-flow-version-store'

const fixture = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected path ${name}`)
      }
      return fixture.userData
    },
    onWillQuit: vi.fn()
  })
}))

let root: string
const START = Date.UTC(2026, 10, 18, 12, 0, 0)
let clock = START

function flow(id: string, name: string): HarnessFlow {
  return { ...createHarnessExampleFlow(1_000), id, name }
}

function historyPath(flowId: string): string {
  return join(fixture.userData, 'harness-flow-versions', `${flowId}.json`)
}

async function record(target: HarnessFlow, summary: string, author: 'person' | 'agent' = 'agent') {
  clock += 1_000
  vi.setSystemTime(clock)
  return recordHarnessFlowVersion({ flow: target, author, summary })
}

beforeEach(() => {
  clock = START
  vi.useFakeTimers({ toFake: ['Date'] })
  root = mkdtempSync(join(tmpdir(), 'topo-harness-flow-versions-'))
  fixture.userData = join(root, 'user-data')
  mkdirSync(fixture.userData)
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('harness flow version store', () => {
  it('records versions into the per-flow file and lists them newest first without the flow', async () => {
    const first = await record(flow('flow-a', 'Uno'), '  Primera versión  ', 'person')
    await record(flow('flow-a', 'Dos'), 'Segunda versión')
    await record(flow('flow-a', 'Tres'), 'Tercera versión')

    expect(first).toEqual({
      id: expect.any(String),
      flowId: 'flow-a',
      createdAt: START + 1_000,
      author: 'person',
      summary: 'Primera versión'
    })
    expect(existsSync(historyPath('flow-a'))).toBe(true)

    const listed = await listHarnessFlowVersions('flow-a')
    expect(listed.map((version) => [version.summary, version.author])).toEqual([
      ['Tercera versión', 'agent'],
      ['Segunda versión', 'agent'],
      ['Primera versión', 'person']
    ])
    expect(listed[2]).toEqual(first)
    expect(new Set(listed.map((version) => version.id)).size).toBe(3)
    expect(listed.some((version) => 'flow' in version)).toBe(false)
  })

  it('keeps each flow history separate', async () => {
    await record(flow('flow-a', 'Uno'), 'Solo en A')

    expect(await listHarnessFlowVersions('flow-b')).toEqual([])
    expect(existsSync(historyPath('flow-b'))).toBe(false)
  })

  it('gets a version with its flow snapshot, or null when it does not exist', async () => {
    const original = flow('flow-a', 'Original')
    const saved = await record(original, 'Original')
    await record(flow('flow-a', 'Editado'), 'Editado')

    expect(await getHarnessFlowVersion('flow-a', saved.id)).toEqual({ ...saved, flow: original })
    expect(await getHarnessFlowVersion('flow-a', 'missing-version')).toBeNull()
    expect(await getHarnessFlowVersion('flow-b', saved.id)).toBeNull()
  })

  it('keeps at most 200 versions per flow, dropping the oldest', async () => {
    const target = flow('flow-a', 'Uno')
    for (let index = 1; index <= 201; index += 1) {
      await record(target, `v${index}`)
    }

    const listed = await listHarnessFlowVersions('flow-a')
    expect(listed).toHaveLength(200)
    expect(listed[0].summary).toBe('v201')
    expect(listed[199].summary).toBe('v2')
    expect(listed.some((version) => version.summary === 'v1')).toBe(false)
  })

  it('deletes the whole history of one flow only', async () => {
    const saved = await record(flow('flow-a', 'Uno'), 'A')
    await record(flow('flow-b', 'Otro'), 'B')

    await deleteHarnessFlowVersions('flow-a')

    expect(await listHarnessFlowVersions('flow-a')).toEqual([])
    expect(await getHarnessFlowVersion('flow-a', saved.id)).toBeNull()
    expect(existsSync(historyPath('flow-a'))).toBe(false)
    expect((await listHarnessFlowVersions('flow-b')).map((version) => version.summary)).toEqual([
      'B'
    ])
  })

  it('never overwrites an unreadable history file', async () => {
    mkdirSync(join(fixture.userData, 'harness-flow-versions'))
    writeFileSync(historyPath('flow-a'), '{"versions": [corrupt')

    await expect(listHarnessFlowVersions('flow-a')).rejects.toThrow(
      'harness_flow_versions_unreadable'
    )
    await expect(record(flow('flow-a', 'Uno'), 'Nueva')).rejects.toThrow(
      'harness_flow_versions_unreadable'
    )
    expect(readFileSync(historyPath('flow-a'), 'utf8')).toBe('{"versions": [corrupt')
  })

  it('rejects a summary that is blank or longer than 500 characters without storing it', async () => {
    const target = flow('flow-a', 'Uno')

    await expect(record(target, 'x'.repeat(501))).rejects.toThrow('harness_flow_version_invalid')
    await expect(record(target, '   ')).rejects.toThrow('harness_flow_version_invalid')
    expect(await listHarnessFlowVersions('flow-a')).toEqual([])

    const longest = await record(target, ` ${'x'.repeat(500)} `)
    expect(longest.summary).toBe('x'.repeat(500))
  })
})
