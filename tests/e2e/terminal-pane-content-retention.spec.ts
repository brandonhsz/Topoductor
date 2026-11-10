// Require scrollback retention across tab, pane and worktree changes.

import { test, expect } from './helpers/topo-app'
import {
  discoverActivePtyId,
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent
} from './helpers/terminal'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal pane retains content when switching tabs and back', async ({ topoPage }) => {
    const ptyId = await discoverActivePtyId(topoPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(topoPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(topoPage, marker)

    const worktreeId = (await getActiveWorktreeId(topoPage))!
    await pressShortcut(topoPage, 't')

    await expect
      .poll(async () => (await getWorktreeTabs(topoPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    const activeType = await getActiveTabType(topoPage)
    expect(activeType).toBe('terminal')

    await pressShortcut(topoPage, 'BracketLeft', { shift: true })

    await expect
      .poll(async () => (await getTerminalContent(topoPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    await pressShortcut(topoPage, 'BracketRight', { shift: true })
    await pressShortcut(topoPage, 'w')
  })

  test('terminal pane retains content when splitting and closing a pane', async ({ topoPage }) => {
    const ptyId = await discoverActivePtyId(topoPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(topoPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(topoPage, marker)

    const panesBefore = await countVisibleTerminalPanes(topoPage)

    await splitActiveTerminalPane(topoPage, 'vertical')
    await waitForPaneCount(topoPage, panesBefore + 1)

    await focusLastTerminalPane(topoPage)
    await closeActiveTerminalPane(topoPage)
    await waitForPaneCount(topoPage, panesBefore)

    await expect
      .poll(async () => (await getTerminalContent(topoPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  test('terminal pane retains content when switching worktrees and back', async ({ topoPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(topoPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(topoPage))!

    const ptyId = await discoverActivePtyId(topoPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(topoPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(topoPage, marker)

    const otherId = await switchToOtherWorktree(topoPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(topoPage), { timeout: 5_000 }).toBe(otherId)

    await switchToWorktree(topoPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(topoPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Poll the retained marker after worktree return: serialize-addon rebind can lag the activation cascade, so avoid an earlier manager-timing assertion.
    await ensureTerminalVisible(topoPage)

    await expect
      .poll(async () => (await getTerminalContent(topoPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
