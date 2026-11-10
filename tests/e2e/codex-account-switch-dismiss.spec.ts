import { expect, test } from './helpers/topo-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId, waitForTerminalOutput } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('account switch actions return keyboard input to the terminal', async ({
  topoPage
}, testInfo) => {
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  await ensureTerminalVisible(topoPage)
  await configureGoldenStubAgent(topoPage)
  await launchGoldenStubAgentFromNewTab(topoPage)

  for (const action of ['outside', 'keep', 'escape', 'restart'] as const) {
    const ptyId = await waitForActivePanePtyId(topoPage)
    await topoPage.evaluate(
      ({ ptyId, action }) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is unavailable')
        }
        store.getState().markCodexRestartNotices([
          {
            ptyId,
            previousAccountLabel: 'Previous account',
            nextAccountLabel: `Current account (${action})`
          }
        ])
      },
      { ptyId, action }
    )
    const dialog = topoPage.getByRole('dialog').filter({ hasText: 'Account switched' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    if (action === 'outside') {
      const cardText = await dialog.getByText(/Restart this session to use/).boundingBox()
      const backdrop = await dialog.boundingBox()
      if (!cardText || !backdrop) {
        throw new Error('Account prompt has no rendered bounds')
      }
      // Why centered: the sidebar seam's resize and scrollbar strips overlap the pane's left edge.
      const outside = { x: backdrop.width / 2, y: 8 }
      await topoPage.mouse.move(cardText.x + 8, cardText.y + 8)
      await topoPage.mouse.down()
      await topoPage.mouse.move(backdrop.x + outside.x, backdrop.y + outside.y)
      await topoPage.mouse.up()
      await expect(dialog).toBeVisible()
      await topoPage.screenshot({ path: testInfo.outputPath('account-switched.png') })
      await dialog.click({ position: outside })
    } else if (action === 'escape') {
      await topoPage.keyboard.press('Escape')
    } else {
      await dialog
        .getByRole('button', {
          name: action === 'keep' ? 'Keep old account' : 'Restart',
          exact: true
        })
        .click()
    }
    await expect(dialog).toHaveCount(0)
    const input = topoPage.locator('.xterm-helper-textarea:focus')
    await expect(input).toHaveCount(1)
    if (action === 'restart') {
      // This check covers the focus handoff; process replacement is a separate contract.
      break
    }
    // A printed reply proves input reached the process without an extra terminal click.
    const marker = `ACCOUNT_SWITCH_${action.toUpperCase()}`
    await topoPage.keyboard.type(marker)
    await topoPage.keyboard.press('Enter')
    await waitForTerminalOutput(topoPage, `[GOLDEN_STUB_AGENT_SUBMITTED] ${marker}`, 20_000)
    await expect(input).toHaveCount(1)
    await topoPage.screenshot({ path: testInfo.outputPath(`after-${action}.png`) })
  }
})
