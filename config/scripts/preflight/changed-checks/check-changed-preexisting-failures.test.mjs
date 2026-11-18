import { expect, it } from 'vitest'
import {
  parseVitestFailures,
  reclassifyUnitTestFailures,
  splitPreexistingFailures
} from './check-changed-preexisting-failures.mjs'

const MERGE_BASE = '1444c5c8e739abcdef'
const HOOK = 'src/main/agent-hooks/server/testing/identity/server-hook-session-binding.test.ts'
const JIRA = 'src/renderer/src/store/slices/jira/jira-web-client-status.test.ts'

// Lines copied from a real `pnpm check:changed` run whose unit-test task failed.
const BRANCH_OUTPUT = [
  `\u001b[31m FAIL \u001b[39m |bun-shared| ${HOOK} > settles the complete HTTP parent iteration after sessionless`,
  ` FAIL  |bun-shared| ${HOOK} > matches only the actual hook against a 257-character unproven legacy tuple after hydration`,
  ` FAIL  |bun-shared| ${JIRA} > keeps the paired web client disconnected when its unwired Jira preload resolves undefined`,
  ' Test Files  2 failed | 680 passed (682)'
].join('\n')
const BASE_OUTPUT = [
  `   × settles the complete HTTP parent iteration after sessionless 78ms`,
  ` FAIL  |bun-shared| ${HOOK} > settles the complete HTTP parent iteration after sessionless`,
  ` FAIL  |bun-shared| ${HOOK} > matches only the actual hook against a 257-character unproven legacy tuple after hydration`
].join('\n')

const failed = (output) => ({ task: { name: 'unit tests' }, ok: false, output, elapsed: '1s' })

it('parses failing tests, including colored and file-level failures', () => {
  expect(
    parseVitestFailures(`${BRANCH_OUTPUT}\n FAIL  src/x/broken.test.tsx [ src/x/broken.test.tsx ]`)
  ).toEqual([
    `${HOOK} > settles the complete HTTP parent iteration after sessionless`,
    `${HOOK} > matches only the actual hook against a 257-character unproven legacy tuple after hydration`,
    `${JIRA} > keeps the paired web client disconnected when its unwired Jira preload resolves undefined`,
    'src/x/broken.test.tsx'
  ])
})

it('treats only exact base reproductions as preexisting', () => {
  expect(splitPreexistingFailures(['a > one', 'a > two'], ['a > one'])).toEqual({
    preexisting: ['a > one'],
    introduced: ['a > two']
  })
})

it('passes the task when the merge base fails the same tests', async () => {
  const hookOnly = BRANCH_OUTPUT.split('\n')
    .filter((line) => !line.includes(JIRA))
    .join('\n')
  let ranOnBase = null
  const result = await reclassifyUnitTestFailures(failed(hookOnly), {
    mergeBase: MERGE_BASE,
    runOnBase: async (files) => {
      ranOnBase = files
      return BASE_OUTPUT
    }
  })
  expect(ranOnBase).toEqual([HOOK])
  expect(result.ok).toBe(true)
  expect(result.note).toContain('Preexisting on 1444c5c8e7')
})

it('keeps the task failed when a failure does not reproduce on the base', async () => {
  const result = await reclassifyUnitTestFailures(failed(BRANCH_OUTPUT), {
    mergeBase: MERGE_BASE,
    runOnBase: async () => BASE_OUTPUT
  })
  expect(result.ok).toBe(false)
  expect(result.output).toContain(`✗ ${JIRA} > keeps the paired web client`)
  expect(result.output).toContain(`≈ ${HOOK} > settles the complete HTTP parent iteration`)
})

it('keeps the task failed when nothing parses or the base cannot run', async () => {
  const timeout = failed('Timed out after 30 min')
  expect(
    await reclassifyUnitTestFailures(timeout, {
      mergeBase: MERGE_BASE,
      runOnBase: async () => {
        throw new Error('must not run')
      }
    })
  ).toBe(timeout)
  const noBase = await reclassifyUnitTestFailures(failed(BRANCH_OUTPUT), {
    mergeBase: MERGE_BASE,
    runOnBase: async () => null
  })
  expect(noBase.ok).toBe(false)
  expect(noBase.output).toContain('Could not create a merge-base worktree')
})
