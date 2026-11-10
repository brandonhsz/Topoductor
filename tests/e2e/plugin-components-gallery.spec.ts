/**
 * Invariant: the catalog 2 components draw with Topo's own controls and round-trip through the
 * hidden guest: tabs switch, a Table pages and sorts, a Tree loads children lazily, and an Image
 * shows a plugin file Topo read itself (an object URL, never a network or file URL).
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/topo-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'
import { ISOLATED_FRAMES_E2E } from './helpers/plugin-frame-guest'

test.use(ISOLATED_FRAMES_E2E)

const TITLE = 'Components Gallery'

test('the components gallery draws forms, data and content components', async ({ topoPage }) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'topo-components-gallery-'))
  const pluginRoot = join(tempRoot, 'components-gallery')
  try {
    await cp(join(process.cwd(), 'examples', 'plugins', 'components-gallery'), pluginRoot, {
      recursive: true
    })
    await enableDevPlugins(topoPage, [pluginRoot])
    await topoPage.evaluate(async () => {
      const store = window.__store?.getState()
      if (store && !store.rightSidebarOpen) {
        store.toggleRightSidebar()
      }
      await window.api.plugins.refresh()
    })
    const panelButton = topoPage.getByRole('button', { name: TITLE })
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()

    const sections = topoPage.getByRole('tablist', { name: 'Gallery sections' })
    await expect(sections).toBeVisible({ timeout: 15_000 })
    // Forms: the Field's error clears once the title is filled in.
    await expect(topoPage.getByRole('alert')).toHaveText('Give the task a title')
    await topoPage.getByRole('textbox', { name: 'Title' }).fill('Write docs')
    await expect(topoPage.getByRole('alert')).toHaveCount(0)
    await topoPage.getByRole('radio', { name: 'High' }).click()
    await expect(topoPage.getByRole('radio', { name: 'High' })).toBeChecked()

    // Data: the Table draws rows from the guest and asks for more as it scrolls.
    await topoPage.getByRole('tab', { name: 'Data' }).click()
    const table = topoPage.getByRole('grid', { name: 'Files' })
    await expect(table).toHaveAttribute('aria-rowcount', '51')
    await expect(table.getByText('doc-002.md')).toBeVisible()
    await table.getByText('doc-002.md').click()
    await expect(topoPage.getByText('1 selected')).toBeVisible()
    await table
      .getByRole('row')
      .nth(1)
      .evaluate((row) => {
        row.parentElement?.parentElement?.scrollTo({ top: 10_000 })
      })
    await expect(table).toHaveAttribute('aria-rowcount', '101')
    await table.getByRole('button', { name: 'Bytes' }).click()
    await expect(table.getByRole('columnheader', { name: 'Bytes' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )

    const tree = topoPage.getByRole('tree', { name: 'Folders' })
    const src = tree.getByRole('treeitem', { name: 'src' })
    await src.focus()
    await topoPage.keyboard.press('ArrowRight')
    await expect(tree.getByRole('treeitem', { name: 'main.ts' })).toBeVisible()
    await expect(src).toHaveAttribute('aria-expanded', 'true')

    // Content: Markdown, code and a plugin image Topo read through main.
    await topoPage.getByRole('tab', { name: 'Content' }).click()
    await expect(topoPage.getByRole('toolbar', { name: 'Gallery actions' })).toBeVisible()
    await expect(topoPage.getByRole('heading', { name: 'Components Gallery' })).toBeVisible()
    await expect(topoPage.getByText('greet.ts')).toBeVisible()
    const logo = topoPage.getByRole('img', { name: 'Gallery logo' })
    await expect(logo).toHaveAttribute('src', /^blob:/)
    await expect
      .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0)
  } finally {
    await disablePluginSystem(topoPage).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
