import { expect, test } from './helpers/topo-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Split the marker so terminal input echo cannot impersonate successful shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ topoPage }) => {
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  await ensureTerminalVisible(topoPage)
  await configureGoldenStubAgent(topoPage)
  await launchGoldenStubAgentFromNewTab(topoPage)

  await topoPage.keyboard.type('exit')
  await topoPage.keyboard.press('Enter')
  await waitForTerminalOutput(topoPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await topoPage.locator('[data-testid="sortable-tab"]').count()
  await topoPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await topoPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(topoPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(topoPage)
  // A bound pane can precede transport readiness; wait or marker keystrokes may be dropped.
  expect(await waitForRestoredTerminalInputReady(topoPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(topoPage)
  await topoPage.keyboard.type(afterAgent.command)
  await topoPage.keyboard.press('Enter')
  await waitForTerminalOutput(topoPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await topoPage.keyboard.press('Shift+Enter')
  await topoPage.keyboard.type(afterShiftEnter.command)
  await topoPage.keyboard.press('Enter')
  await waitForTerminalOutput(topoPage, afterShiftEnter.marker, 15_000)
  await expect(topoPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
