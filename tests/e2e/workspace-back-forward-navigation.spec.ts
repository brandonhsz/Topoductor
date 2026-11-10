// Drive Back/Forward buttons and Cmd/Ctrl+Alt+Arrow through workspace history.

import { test, expect } from './helpers/topo-app'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getAllWorktreeIds,
  ensureTerminalVisible
} from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

// Seed in production order: setActiveWorktree then recordWorktreeVisit; actual history navigation skips recording.
async function seedVisit(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((id) => {
    // runtime-types exposes a minimal store type; runtime Zustand also supports navigation slice actions.
    type StoreLike = {
      getState: () => {
        setActiveWorktree: (worktreeId: string) => void
        recordWorktreeVisit: (worktreeId: string) => void
      }
    }
    const store = window.__store as unknown as StoreLike
    const state = store.getState()
    state.setActiveWorktree(id)
    state.recordWorktreeVisit(id)
  }, worktreeId)
}

async function resetNavHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    type StoreLike = {
      setState: (partial: { worktreeNavHistory: string[]; worktreeNavHistoryIndex: number }) => void
    }
    const store = window.__store as unknown as StoreLike
    store.setState({ worktreeNavHistory: [], worktreeNavHistoryIndex: -1 })
  })
}

async function getBackButton(page: Page) {
  return page.getByRole('button', { name: 'Go back' })
}

async function getForwardButton(page: Page) {
  return page.getByRole('button', { name: 'Go forward' })
}

const isMac = process.platform === 'darwin'
const mod = isMac ? 'Meta' : 'Control'

test.describe('Workspace Back/Forward Navigation', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
  })

  test('clicking Back and Forward walks the history stack', async ({ topoPage }) => {
    const worktreeIds = await getAllWorktreeIds(topoPage)
    test.skip(worktreeIds.length < 2, 'Need at least two worktrees to exercise back/forward')
    const [primaryId, secondaryId] = worktreeIds

    await resetNavHistory(topoPage)
    await seedVisit(topoPage, primaryId)
    await seedVisit(topoPage, secondaryId)

    const back = await getBackButton(topoPage)
    const forward = await getForwardButton(topoPage)
    await expect(back).toBeEnabled()
    await expect(forward).toBeDisabled()

    // Assert sidebar aria-current for active worktree; aria-selected tracks batch selection and store-only reads miss render regressions.
    const primaryRow = worktreeRow(topoPage, primaryId)
    const secondaryRow = worktreeRow(topoPage, secondaryId)

    await back.click()
    await expect
      .poll(async () => getActiveWorktreeId(topoPage), {
        message: 'Back click did not activate the previous worktree'
      })
      .toBe(primaryId)
    await expect(primaryRow).toHaveAttribute('aria-current', 'page')
    await expect(secondaryRow).not.toHaveAttribute('aria-current', 'page')
    await expect(back).toBeDisabled()
    await expect(forward).toBeEnabled()

    await forward.click()
    await expect
      .poll(async () => getActiveWorktreeId(topoPage), {
        message: 'Forward click did not re-activate the next worktree'
      })
      .toBe(secondaryId)
    await expect(secondaryRow).toHaveAttribute('aria-current', 'page')
    await expect(primaryRow).not.toHaveAttribute('aria-current', 'page')
    await expect(forward).toBeDisabled()
  })

  test(`${isMac ? 'Cmd' : 'Ctrl'}+Alt+Left/Right shortcuts walk history`, async ({ topoPage }) => {
    const worktreeIds = await getAllWorktreeIds(topoPage)
    test.skip(worktreeIds.length < 2, 'Need at least two worktrees to exercise shortcuts')
    const [primaryId, secondaryId] = worktreeIds

    await resetNavHistory(topoPage)
    await seedVisit(topoPage, primaryId)
    await seedVisit(topoPage, secondaryId)

    // Focus body so editable-target checks cannot swallow the window shortcut in hidden Electron.
    await topoPage.evaluate(() => document.body.focus())

    await topoPage.keyboard.press(`${mod}+Alt+ArrowLeft`)
    await expect
      .poll(async () => getActiveWorktreeId(topoPage), {
        message: `${mod}+Alt+Left did not navigate back`
      })
      .toBe(primaryId)

    await topoPage.keyboard.press(`${mod}+Alt+ArrowRight`)
    await expect
      .poll(async () => getActiveWorktreeId(topoPage), {
        message: `${mod}+Alt+Right did not navigate forward`
      })
      .toBe(secondaryId)
  })
})
