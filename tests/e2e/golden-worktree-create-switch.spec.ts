import { removeWorktreeViaStore } from './helpers/dead-terminal'
import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/topo-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { createTerminalTabFromMenu } from './helpers/terminal-tab-menu'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { splitMarkerEchoCommand } from './terminal-marker-echo-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

async function createWorkspace(page: Page, name: string): Promise<void> {
  await openSidebarWorkspaceComposer(page)
  const dialog = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(/Type a name/i).fill(name)
  await dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

test('creates a worktree, keeps its terminal isolated, and switches back @golden', async ({
  topoPage
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(topoPage)
  const originalWorktreeId = await waitForActiveWorktree(topoPage)
  await waitForActiveTerminalManager(topoPage, 30_000)
  const parentPtyId = await waitForActivePanePtyId(topoPage)
  const workspaceName = `golden-switch-${Date.now()}`
  let childWorktreeId: string | null = null

  try {
    await createWorkspace(topoPage, workspaceName)
    await expect(
      topoPage.locator('[role="option"][aria-current="page"]').filter({ hasText: workspaceName })
    ).toBeVisible({ timeout: 30_000 })
    childWorktreeId = await waitForActiveWorktree(topoPage)
    // Why: the cleanup force-removes childWorktreeId, so it must never resolve to the original.
    expect(childWorktreeId).not.toBe(originalWorktreeId)
    await expect(
      topoPage.locator(`[role="option"][data-worktree-id="${childWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page')

    await createTerminalTabFromMenu(topoPage)
    await waitForActiveTerminalManager(topoPage, 30_000)
    const childPtyId = await waitForActivePanePtyId(topoPage)
    expect(childPtyId).not.toBe(parentPtyId)
    await waitForPtyShellEcho(topoPage, childPtyId, 15_000)
    await execInTerminal(topoPage, childPtyId, splitMarkerEchoCommand('worktree', '-b'))
    await waitForTerminalOutput(topoPage, 'worktree-b')

    await topoPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`).click()
    await expect(
      topoPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
    // Wait for store activation too: sidebar aria-current can precede the child terminal’s manager remount.
    await expect
      .poll(() => getActiveWorktreeId(topoPage), {
        timeout: 20_000,
        message: 'store did not activate the original worktree after sidebar click'
      })
      .toBe(originalWorktreeId)
    await ensureTerminalVisible(topoPage)
    await waitForActiveTerminalManager(topoPage, 30_000)
    expect(await waitForActivePanePtyId(topoPage, 30_000)).toBe(parentPtyId)
  } finally {
    if (childWorktreeId) {
      if ((await getActiveWorktreeId(topoPage).catch(() => null)) !== originalWorktreeId) {
        await topoPage
          .locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
          .click()
          .catch(() => undefined)
      }
      await removeWorktreeViaStore(topoPage, childWorktreeId)
    }
  }
})
