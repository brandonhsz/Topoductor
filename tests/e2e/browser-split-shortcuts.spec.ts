import { expect, test } from './helpers/topo-app'
import type { Page } from '@stablyai/playwright-test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    topoPage
  }) => {
    const fixture = await createTerminalBrowserSplit(topoPage)

    await topoPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(topoPage)
    await waitForFocusedGroup(topoPage, fixture.terminalGroupId)
    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(topoPage)).toBeFocused()
    await expect(browserFindInput(topoPage)).toBeHidden()
    await topoPage.keyboard.press('Escape')

    await focusBrowserGroup(topoPage, fixture.browserGroupId)
    await focusBrowserAddressBar(topoPage, fixture.browserTabId)
    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(topoPage)).toBeFocused()
    await expect(terminalFindInput(topoPage)).toBeHidden()
    await browserFindCloseButton(topoPage).click()
    await expect(browserFindInput(topoPage)).toBeHidden()

    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(topoPage)).toBeFocused()
    await browserFindCloseButton(topoPage).click()

    await topoPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      topoPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(topoPage)
    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(topoPage)).toBeFocused()
    await expect(browserFindInput(topoPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    topoPage
  }) => {
    const fixture = await createBrowserSplit(topoPage)

    await pressFindInBrowserGuest(topoPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(topoPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(topoPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        topoPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    topoPage
  }) => {
    const fixture = await createTerminalBrowserSplit(topoPage)
    await focusBrowserGroup(topoPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(topoPage, fixture.browserTabId)
    await focusBrowserAddressBar(topoPage, fixture.browserTabId)

    await topoPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(topoPage)).toBeFocused()
    await expect(terminalFindInput(topoPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ topoPage }) => {
    const fixture = await createTerminalBrowserSplit(topoPage)
    await focusBrowserGroup(topoPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(topoPage, fixture.browserTabId)
    await focusBrowserAddressBar(topoPage, fixture.browserTabId)

    await topoPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await topoPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(topoPage)).toBeFocused()
    await expect(terminalFindInput(topoPage)).toBeHidden()
  })
})
