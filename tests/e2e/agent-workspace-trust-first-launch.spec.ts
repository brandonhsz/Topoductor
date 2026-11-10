import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/topo-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_READY_MARKER
} from './helpers/golden-stub-agent'
import { addRepoWithWorkspaces } from './helpers/repo-with-workspaces'
import { ensureTerminalVisible, switchToWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, waitForTerminalOutput } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

const CLAUDE_MENU_ITEM = /^Claude(?:\s|$)/i

async function startClaudeFromNewTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New tab' }).click({ force: true })
  const launchOption = page.getByRole('menuitem', { name: CLAUDE_MENU_ITEM }).first()
  await expect(launchOption).toBeVisible({ timeout: 15_000 })
  await launchOption.click({ force: true })
}

async function waitForAgentReady(page: Page): Promise<void> {
  await focusActiveTerminalInput(page)
  await waitForTerminalOutput(page, GOLDEN_STUB_READY_MARKER, 20_000)
}

async function readRepoDecision(page: Page, repoId: string): Promise<string | null> {
  return page.evaluate(
    (id) =>
      window.__store?.getState().repos.find((repo) => repo.id === id)?.agentWorkspaceTrust ?? null,
    repoId
  )
}

test('the first agent launch in a new repo asks once, and its worktrees share the answer', async ({
  topoPage
}, testInfo) => {
  await waitForSessionReady(topoPage)
  await configureGoldenStubAgent(topoPage, { agent: 'claude' })
  // A repo added now has no stored answer, like a fresh clone after the upgrade.
  const { repoId, mainId, ids } = await addRepoWithWorkspaces(topoPage, testInfo, 1)
  await switchToWorktree(topoPage, mainId)
  await ensureTerminalVisible(topoPage)

  await startClaudeFromNewTab(topoPage)
  const prompt = topoPage.getByRole('dialog', { name: /for agents\?$/ })
  await expect(prompt).toBeVisible({ timeout: 15_000 })
  await topoPage.screenshot({ path: testInfo.outputPath('first-launch-prompt.png') })
  expect(await readRepoDecision(topoPage, repoId)).toBeNull()

  await prompt.getByRole('button', { name: 'Let agents ask', exact: true }).click()
  await expect(prompt).toBeHidden()
  await waitForAgentReady(topoPage)
  expect(await readRepoDecision(topoPage, repoId)).toBe('agent-asks')

  // Another worktree of the same repo reuses the stored answer.
  const [sibling] = ids
  if (!sibling) {
    throw new Error('the repo needs a second worktree')
  }
  await switchToWorktree(topoPage, sibling)
  await ensureTerminalVisible(topoPage)
  await startClaudeFromNewTab(topoPage)
  await waitForAgentReady(topoPage)
  await expect(prompt).toHaveCount(0)

  await topoPage.evaluate((id) => {
    const state = window.__store?.getState()
    state?.setSettingsSearchQuery('')
    state?.openSettingsTarget({ pane: 'repo', repoId: id })
    state?.openSettingsPage()
  }, repoId)
  const trustControl = topoPage.getByRole('radiogroup', { name: 'Agent Folder Trust' })
  await trustControl.scrollIntoViewIfNeeded()
  await expect(trustControl.getByRole('radio', { name: 'Let agents ask' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await topoPage.screenshot({ path: testInfo.outputPath('repo-setting.png') })

  await trustControl.getByRole('radio', { name: 'Trust repository' }).click()
  await expect.poll(() => readRepoDecision(topoPage, repoId)).toBe('pre-trust')
})
