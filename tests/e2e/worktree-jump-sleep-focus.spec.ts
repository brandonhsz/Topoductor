import { test, expect } from './helpers/topo-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  topoPage
}, testInfo) => {
  await waitForSessionReady(topoPage)
  const source = await waitForActiveWorktree(topoPage)
  const target = (await getAllWorktreeIds(topoPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(topoPage, target)
  await ensureTerminalVisible(topoPage)
  await waitForActiveTerminalManager(topoPage)
  await waitForActivePanePtyId(topoPage)
  const targetName = await topoPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(topoPage, source)
  await topoPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await topoPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await topoPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = topoPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await topoPage.context().newCDPSession(topoPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await topoPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(topoPage)
  await waitForActivePanePtyId(topoPage)
  const terminal = topoPage.locator('[data-terminal-tab-id]:visible .xterm-helper-textarea').first()
  await topoPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await topoPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await topoPage.keyboard.press('Enter')
  await waitForTerminalOutput(topoPage, 'WAKE_KEYBOARD_OK')
  await topoPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
