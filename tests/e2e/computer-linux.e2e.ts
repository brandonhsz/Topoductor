import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ComputerActionResult, ComputerSnapshotResult } from '../../src/shared/runtime-types'
import {
  ensureTopoRuntimeLaunched,
  ensureGeditLaunched,
  findRoleIndex,
  killGedit,
  parseJsonOutput,
  runTopoCli
} from './helpers/computer-driver'

const isLinux = process.platform === 'linux'
const e2eOptIn = process.env.TOPO_COMPUTER_E2E === '1'

async function focusGeditDocument(): Promise<void> {
  const before = parseJsonOutput<{ result: ComputerSnapshotResult }>(
    (
      await runTopoCli([
        'computer',
        'get-app-state',
        '--app',
        'gedit',
        '--restore-window',
        '--no-screenshot',
        '--json'
      ])
    ).stdout
  )
  const textIndex = findRoleIndex(
    before.result.snapshot.treeText,
    /^\s*(\d+)\s+(text|text entry|entry|document|edit area)(?:\s|$)/im
  )
  expect(textIndex).toBeGreaterThanOrEqual(0)

  await runTopoCli([
    'computer',
    'click',
    '--app',
    'gedit',
    '--element-index',
    String(textIndex),
    '--restore-window',
    '--no-screenshot',
    '--json'
  ])
}

describe.skipIf(!isLinux || !e2eOptIn)('computer-use Linux e2e (gedit)', () => {
  beforeAll(async () => {
    await ensureTopoRuntimeLaunched()
    await ensureGeditLaunched()
  })

  afterAll(async () => {
    await killGedit()
  })

  test('click and type-text insert into the focused document through AT-SPI', async () => {
    await focusGeditDocument()

    const marker = ` topo-linux-type-${Date.now()}-élan-🚀`
    const typed = parseJsonOutput<{ result: ComputerActionResult }>(
      (
        await runTopoCli([
          'computer',
          'type-text',
          '--app',
          'gedit',
          '--text',
          marker,
          '--restore-window',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(typed.result.action?.path).toBe('accessibility')
    expect(typed.result.snapshot.treeText).toContain(marker.trim())
  })

  test('paste-text mutates the test-owned document', async () => {
    await focusGeditDocument()

    const marker = `topo-linux-paste-${Date.now()}-café-🚀`
    const action = parseJsonOutput<{ result: ComputerActionResult }>(
      (
        await runTopoCli([
          'computer',
          'paste-text',
          '--app',
          'gedit',
          '--text',
          marker,
          '--restore-window',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(action.result.action?.path).toBe('accessibility')
    expect(action.result.action?.verification).toMatchObject({
      state: 'verified',
      property: 'focusedText'
    })

    const after = parseJsonOutput<{ result: ComputerSnapshotResult }>(
      (
        await runTopoCli([
          'computer',
          'get-app-state',
          '--app',
          'gedit',
          '--no-screenshot',
          '--json'
        ])
      ).stdout
    )
    expect(after.result.snapshot.treeText).toContain(marker)
  })
})
