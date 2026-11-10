import { test, expect } from './helpers/topo-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: on narrow windows the titlebar tab strip switches panels the board covers.
test.describe('Workspace board right-sidebar tab dismiss', () => {
  test.skip(process.platform !== 'darwin', 'Linux and Windows draw the tab strip under the board')

  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
  })

  test('clicking a right-sidebar tab closes the board and shows that tab', async ({
    electronApp,
    topoPage
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1000, 800)
    })
    await topoPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('window.__store is not available')
      }
      state.setSidebarOpen(true)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('explorer')
    })

    await topoPage.getByRole('button', { name: 'Workspace board' }).click()
    const board = topoPage.locator('[data-workspace-board-sheet]')
    await expect(board).toBeVisible()
    await board.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

    await topoPage.getByRole('button', { name: /^Source Control/ }).click()

    await expect(board).toBeHidden()
    await expect(topoPage.getByTestId('source-control-filter-toggle')).toBeVisible()
  })
})
