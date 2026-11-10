import { expect, test } from './helpers/topo-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  topoPage
}) => {
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  await openFileExplorer(topoPage)

  const readmeRow = topoPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(topoPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(topoPage, 'f')

  await expect(
    topoPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
