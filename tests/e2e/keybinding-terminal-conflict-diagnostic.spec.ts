import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/topo-app'
import { waitForSessionReady } from './helpers/store'

const CONFLICTING_FILE = `${JSON.stringify(
  { version: 1, keybindings: { 'terminal.splitRight': ['Mod+Alt+ArrowRight'] } },
  null,
  2
)}\n`

test.describe('Terminal shortcut conflicting with a chord main intercepts', () => {
  test('keeps the saved override and reports the conflict in Settings', async ({
    topoPage,
    electronApp
  }) => {
    await waitForSessionReady(topoPage)

    const isolatedHome = await electronApp.evaluate(({ app }) => app.getPath('home'))
    mkdirSync(path.join(isolatedHome, '.topo'), { recursive: true })
    writeFileSync(path.join(isolatedHome, '.topo', 'keybindings.json'), CONFLICTING_FILE)

    const savedOverride = await topoPage.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      await store.getState().updateSettings({ uiLanguage: 'en' })
      await store.getState().reloadKeybindings()
      store.getState().openSettingsPage()
      return store.getState().keybindings['terminal.splitRight']
    })
    expect(savedOverride).toEqual(['Mod+Alt+ArrowRight'])

    const searchInput = topoPage.getByPlaceholder('Search settings')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('shortcuts')
    await expect(topoPage.getByRole('heading', { name: 'Shortcuts', exact: true })).toBeVisible()

    await topoPage.getByRole('button', { name: /Conflicts/ }).click()
    await expect(topoPage.getByText('Split terminal right', { exact: true })).toBeVisible()
    await expect(topoPage.getByText('Worktree History Forward', { exact: true })).toBeVisible()
    await expect(
      topoPage.getByText(/conflicts with .*Worktree History Forward/).first()
    ).toBeVisible()
  })
})
