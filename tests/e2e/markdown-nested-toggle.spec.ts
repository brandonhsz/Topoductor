import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/topo-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
  })

  test('editing a nested toggle survives save and reopen', async ({ topoPage }, testInfo) => {
    const context = await getActiveWorktreeContext(topoPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(topoPage, context, filePath)
      await waitForRichMarkdownEditor(topoPage)
      await expectEditableNestedToggles(topoPage)

      await placeCaretInNestedToggleBody(topoPage)
      await topoPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(topoPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await topoPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // Reopen the saved bytes from scratch; the reported bug appeared only after reparsing.
      await closeActiveEditorTab(topoPage, savedPath)
      await openMarkdownFixture(topoPage, context, savedPath)
      await waitForRichMarkdownEditor(topoPage)
      await expectEditableNestedToggles(topoPage)
      await expectSentinelInsideNestedToggle(topoPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    topoPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(topoPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(topoPage, context, filePath)
      await waitForRichMarkdownEditor(topoPage)

      await expectPassthroughFallback(topoPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
