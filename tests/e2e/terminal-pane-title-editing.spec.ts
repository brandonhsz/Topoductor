import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/topo-app'
import { splitActiveTerminalPane, waitForPaneCount } from './helpers/terminal'
import { getActiveWorktreeId, getActiveTabId, getWorktreeTabs } from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import {
  setPaneTitleFromTerminalMenu,
  openTerminalContextMenu
} from './helpers/terminal-pane-title-actions'
import './helpers/terminal-pane-geometry'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

async function openPaneTitleContextMenu(page: Page, title: string): Promise<void> {
  const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = (await page.evaluate(() =>
    navigator.userAgent.includes('Windows')
  ))
    ? ['Control']
    : []
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'))
  const titleBar = page.locator('.pane-title-bar', { hasText: title }).first()
  await expect(titleBar).toBeVisible()
  await titleBar.click({
    button: isMac ? 'left' : 'right',
    position: { x: 20, y: 10 },
    modifiers: isMac ? ['Control'] : modifiers
  })
  await expect(page.getByText('Set Title…', { exact: true })).toBeVisible()
}

async function getTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string
): Promise<string | null> {
  return page.evaluate(
    ({ targetWorktreeId, targetTabId }) => {
      const state = window.__store!.getState()
      const tab = (state.tabsByWorktree[targetWorktreeId] ?? []).find(
        (entry) => entry.id === targetTabId
      )
      return tab?.customTitle ?? null
    },
    { targetWorktreeId: worktreeId, targetTabId: tabId }
  )
}

async function expectTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string,
  expected: string | null
): Promise<void> {
  await expect
    .poll(() => getTabCustomTitle(page, worktreeId, tabId), { timeout: 3_000 })
    .toBe(expected)
}

async function expectSavedLayoutNotToContainTitle(
  page: Page,
  tabId: string,
  title: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetTabId, title }) => {
            const layout = window.__store!.getState().terminalLayoutsByTabId[targetTabId]
            return Object.values(layout?.titlesByLeafId ?? {}).includes(title)
          },
          { targetTabId: tabId, title }
        ),
      { timeout: 3_000 }
    )
    .toBe(false)
}

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('first Set Title from terminal context menu stays open for typing', async ({ topoPage }) => {
    const title = `First menu title ${Date.now()}`

    await openTerminalContextMenu(topoPage)
    await topoPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = topoPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await topoPage.waitForTimeout(250)
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()

    await titleInput.fill(title)
    await titleInput.press('Enter')

    await expect(titleInput).toHaveCount(0)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title context menu opens from the title overlay strip', async ({ topoPage }) => {
    const title = `Overlay menu title ${Date.now()}`
    const updatedTitle = `Overlay menu updated ${Date.now()}`

    await setPaneTitleFromTerminalMenu(topoPage, title)
    await openPaneTitleContextMenu(topoPage, title)
    await topoPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = topoPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(titleInput).toHaveValue(title)
    await titleInput.fill(updatedTitle)
    await titleInput.press('Enter')

    await expect(topoPage.locator('.pane-title-text', { hasText: updatedTitle })).toHaveCount(1)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toHaveCount(0)
  })

  test('Set Title commits when tabbing away from the title input', async ({ topoPage }) => {
    const title = `Tab commit title ${Date.now()}`

    await openTerminalContextMenu(topoPage)
    await topoPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = topoPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await titleInput.fill(title)
    await titleInput.press('Tab')

    await expect(titleInput).toHaveCount(0)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title overlay hides with its inactive terminal tab', async ({ topoPage }) => {
    const title = `Hidden tab title ${Date.now()}`
    const worktreeId = (await getActiveWorktreeId(topoPage))!

    await setPaneTitleFromTerminalMenu(topoPage, title)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toBeVisible()

    await pressShortcut(topoPage, 't')
    await expect
      .poll(async () => (await getWorktreeTabs(topoPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toBeHidden()

    await pressShortcut(topoPage, 'BracketLeft', { shift: true })
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
  })

  test('Set Title still commits by blur after focus settles', async ({ topoPage }) => {
    const title = `Blur commit title ${Date.now()}`

    await openTerminalContextMenu(topoPage)
    await topoPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = topoPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await topoPage.waitForTimeout(100)
    await titleInput.fill(title)
    await topoPage
      .locator('.xterm:visible')
      .first()
      .click({ position: { x: 40, y: 60 } })

    await expect(titleInput).toHaveCount(0)
    await expect(topoPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title stays pane-local during agent title churn', async ({ topoPage }) => {
    const worktreeId = (await getActiveWorktreeId(topoPage))!
    const tabId = (await getActiveTabId(topoPage))!
    const paneTitle = `Codex pane ${Date.now()}`
    const removeButtonTitle = `Remove button label ${Date.now()}`
    const splitTitle = `Split label ${Date.now()}`
    const runtimeTitle = '⠋ Codex working'

    await setPaneTitleFromTerminalMenu(topoPage, paneTitle)
    await expect(topoPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expectTabCustomTitle(topoPage, worktreeId, tabId, null)

    await topoPage.getByRole('button', { name: `Edit pane title: ${paneTitle}` }).focus()
    await topoPage.keyboard.press('Enter')
    const paneTitleInput = topoPage.getByRole('textbox', { name: 'Pane title' })
    await expect(paneTitleInput).toBeVisible()
    await expect(paneTitleInput).toBeFocused()
    await topoPage.keyboard.press('Escape')
    await expect(paneTitleInput).toHaveCount(0)
    await expect(topoPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()

    await topoPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )

    // OSC titles may churn continuously; pane-local Set Title must remain visible while tab runtime title follows the active PTY.
    await expect(topoPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expect(
      topoPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
    await expectTabCustomTitle(topoPage, worktreeId, tabId, null)

    await setPaneTitleFromTerminalMenu(topoPage, '')
    await expect(topoPage.locator('.pane-title-text', { hasText: paneTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(topoPage, tabId, paneTitle)

    await setPaneTitleFromTerminalMenu(topoPage, removeButtonTitle)
    await setPaneTitleFromTerminalMenu(topoPage, '')
    await expect(topoPage.locator('.pane-title-text', { hasText: removeButtonTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(topoPage, tabId, removeButtonTitle)

    await setPaneTitleFromTerminalMenu(topoPage, splitTitle)
    await expectTabCustomTitle(topoPage, worktreeId, tabId, null)

    await splitActiveTerminalPane(topoPage, 'vertical')
    await waitForPaneCount(topoPage, 2)
    await expect(topoPage.locator('.pane-title-text', { hasText: splitTitle })).toBeVisible()

    await topoPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )
    await expect(
      topoPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
  })
})
