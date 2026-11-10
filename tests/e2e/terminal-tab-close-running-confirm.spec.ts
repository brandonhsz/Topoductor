// #10142: keyboard and X close must both confirm for the same live sleep 300 child, preserving the tab until approval.
import { test, expect } from './helpers/topo-app'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function countRenderedTabs(page: Page): Promise<number> {
  return page.locator(SORTABLE_TAB).count()
}

function closeDialogTitle(page: Page) {
  return page.getByText(/Stop running command\?|Stop this agent\?/)
}

test.describe.configure({ mode: 'serial' })

test('the tab X button applies the same running-process confirmation as Cmd+W', async ({
  topoPage
}) => {
  test.setTimeout(120_000)
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  await ensureTerminalVisible(topoPage)
  const hasPaneManager = await waitForActiveTerminalManager(topoPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'Electron automation never mounted the live TerminalPane manager.')
  await waitForPaneCount(topoPage, 1, 30_000)

  const ptyId = await waitForActivePanePtyId(topoPage)
  await execInTerminal(topoPage, ptyId, 'echo repro-10142-ready')
  await waitForTerminalOutput(topoPage, 'repro-10142-ready', 20_000)
  await execInTerminal(topoPage, ptyId, 'sleep 300')
  // Wait for sleep as foreground process; macOS login makes hasChildProcesses true before the command starts.
  await expect
    .poll(
      async () =>
        (await topoPage.evaluate((id) => window.api.pty.inspectProcess(id), ptyId))
          .foregroundProcess,
      { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
    )
    .toBe('sleep')

  const busyTabId = (await getActiveTabId(topoPage))!
  const busyTab = topoPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await focusActiveTerminalInput(topoPage)
  await topoPage.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
  await expect(closeDialogTitle(topoPage)).toBeVisible({ timeout: 15_000 })
  await topoPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(closeDialogTitle(topoPage)).toBeHidden()
  await expect(busyTab).toBeVisible()
  const tabsBefore = await countRenderedTabs(topoPage)

  await busyTab.hover()
  await busyTab.getByRole('button', { name: /^Close tab /i }).click()
  await topoPage.waitForTimeout(1_500)

  expect(
    {
      confirmDialogVisible: await closeDialogTitle(topoPage).isVisible(),
      tabStillPresent: (await countRenderedTabs(topoPage)) === tabsBefore
    },
    'X-button close must apply the same running-process confirmation as Cmd+W'
  ).toEqual({ confirmDialogVisible: true, tabStillPresent: true })
})
