/**
 * Invariant: two plugins that share a name, and themes that share a name, are told apart by the
 * Topo-derived publisher in the theme picker and the plugin list.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/topo-app'
import { disablePluginSystem, enableDevPlugins } from './helpers/plugin-smoke'

async function writeCatppuccinPlugin(root: string, publisher: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, 'orca-plugin.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'catppuccin',
      publisher,
      name: 'Catppuccin for Topo',
      version: '1.0.0',
      engines: { orca: '>=1.0.0' },
      pluginApi: 1,
      contributes: { themes: [{ id: 'mocha', title: 'Catppuccin Mocha', path: 'app.json' }] }
    })
  )
  await writeFile(
    join(root, 'app.json'),
    JSON.stringify({
      base: 'dark',
      tokens: { '--background': '#1e1e2e', '--foreground': '#cdd6f4' }
    })
  )
}

async function openSettingsPane(page: Page, pane: 'appearance' | 'plugins'): Promise<void> {
  await page.evaluate((target) => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: target, repoId: null })
    state?.openSettingsPage()
  }, pane)
  await expect(page.locator(`[data-settings-section="${pane}"]`)).toBeVisible()
}

test('plugins and themes sharing a name show their publishers', async ({ topoPage }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'topo-name-clash-'))
  const proofDir = process.env.TOPO_NAME_CLASH_PROOF_DIR
  try {
    await writeCatppuccinPlugin(join(root, 'acme'), 'acme')
    await writeCatppuccinPlugin(join(root, 'vale-c'), 'vale-c')
    await enableDevPlugins(topoPage, [join(root, 'acme'), join(root, 'vale-c')])

    await openSettingsPane(topoPage, 'appearance')
    await topoPage.getByRole('combobox', { name: 'Dark theme', exact: true }).click()
    const options = topoPage.getByRole('option', { name: /^Catppuccin Mocha/ })
    await expect(options).toHaveCount(2)
    await topoPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'theme-picker.png')
    })
    await expect(topoPage.getByRole('option', { name: 'Catppuccin Mocha (acme)' })).toBeVisible()
    await expect(topoPage.getByRole('option', { name: 'Catppuccin Mocha (vale-c)' })).toBeVisible()
    await topoPage.keyboard.press('Escape')

    await openSettingsPane(topoPage, 'plugins')
    const section = topoPage.locator('[data-settings-section="plugins"]')
    await expect(section.getByText(/^Catppuccin for Topo/).first()).toBeVisible()
    await topoPage.screenshot({
      path: join(proofDir ?? testInfo.outputPath(), 'plugin-list.png')
    })
    await expect(section.getByText('Catppuccin for Topo (acme)', { exact: true })).toBeVisible()
    await expect(section.getByText('Catppuccin for Topo (vale-c)', { exact: true })).toBeVisible()
  } finally {
    await disablePluginSystem(topoPage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
