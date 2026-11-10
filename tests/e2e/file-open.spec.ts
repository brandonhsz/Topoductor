import { test, expect } from './helpers/topo-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  getOpenFiles,
  ensureTerminalVisible
} from './helpers/store'
import { clickFileInExplorer, openFileExplorer } from './helpers/file-explorer'

test.describe('File Open & Markdown Preview', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
  })

  test('clicking a file in the file explorer opens it in an editor tab', async ({ topoPage }) => {
    const worktreeId = (await getActiveWorktreeId(topoPage))!
    await openFileExplorer(topoPage)

    const filesBefore = await getOpenFiles(topoPage, worktreeId)

    const clickedFile = await clickFileInExplorer(topoPage, [
      'package.json',
      'tsconfig.json',
      '.gitignore',
      'README.md'
    ])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(topoPage), { timeout: 5_000 }).toBe('editor')

    await expect
      .poll(async () => (await getOpenFiles(topoPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThan(filesBefore.length)

    // Assert the rendered path; allow first-open lazy EditorPanel/Monaco/Markdown chunks to mount.
    await expect(topoPage.locator('.editor-header-path').first()).toContainText(clickedFile!, {
      timeout: 20_000
    })
  })

  test('opening a .md file shows markdown content', async ({ topoPage }) => {
    await openFileExplorer(topoPage)
    const clickedFile = await clickFileInExplorer(topoPage, ['README.md', 'CLAUDE.md'])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(topoPage), { timeout: 5_000 }).toBe('editor')

    // Assert the file’s real heading so a blank editor cannot pass via store state.
    const expectedHeading = clickedFile?.endsWith('README.md')
      ? /Topo E2E Test Repo/i
      : /CLAUDE\.md/i
    // Allow cold EditorPanel → Markdown chunk loading and ProseMirror boot before the heading paints.
    await expect(topoPage.getByRole('heading', { name: expectedHeading, level: 1 })).toBeVisible({
      timeout: 25_000
    })
  })
})
