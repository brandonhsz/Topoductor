import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/topo-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow, worktreeRowSurface } from './worktree-row-locators'

const INSPECTION_ERROR_TEXT = "Couldn't verify this repo's setup script right now."
const SETUP_SCRIPT_COMMAND = 'echo topo-e2e-setup'
const RECORDING_DWELL_MS = 1200

type WorktreeIds = {
  repoId: string
  mainWorktreeId: string
  featureWorktreeId: string
}

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

/** Repo whose shared topo.yaml carries a real setup script, plus a second worktree. */
function createRepoWithSharedSetupScript(repoPath: string, featureWorktreePath: string): void {
  rmSync(repoPath, { recursive: true, force: true })
  rmSync(featureWorktreePath, { recursive: true, force: true })
  mkdirSync(repoPath, { recursive: true })
  runGit(repoPath, ['init'])
  runGit(repoPath, ['config', 'user.email', 'e2e@test.local'])
  runGit(repoPath, ['config', 'user.name', 'E2E Test'])
  writeFileSync(path.join(repoPath, 'README.md'), '# Unreadable topo.yaml E2E\n')
  writeFileSync(path.join(repoPath, 'topo.yaml'), `scripts:\n  setup: ${SETUP_SCRIPT_COMMAND}\n`)
  runGit(repoPath, ['add', '-A'])
  runGit(repoPath, ['commit', '-m', 'Initial commit'])
  runGit(repoPath, ['worktree', 'add', '-b', 'setup-prompt-proof', featureWorktreePath])
}

// Inject unreadable topo.yaml as status:error, not authoritative absence; retain the real handler for healing.
async function installUnreadableTopoYamlFault(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    type InvokeHandler = (event: unknown, ...args: unknown[]) => unknown
    const faultState = globalThis as typeof globalThis & { __topoE2eTopoYamlUnreadable?: boolean }
    const registry = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })
      ._invokeHandlers
    const productionHandler = registry?.get('hooks:check')
    if (!productionHandler) {
      throw new Error('hooks:check handler was not registered in the main process')
    }
    faultState.__topoE2eTopoYamlUnreadable = true
    ipcMain.removeHandler('hooks:check')
    ipcMain.handle('hooks:check', async (event, ...args) => {
      if (faultState.__topoE2eTopoYamlUnreadable) {
        return { status: 'error', hasHooks: false, hooks: null, mayNeedUpdate: false }
      }
      return productionHandler(event, ...args)
    })
  })
}

async function healTopoYamlRead(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(() => {
    ;(
      globalThis as typeof globalThis & { __topoE2eTopoYamlUnreadable?: boolean }
    ).__topoE2eTopoYamlUnreadable = false
  })
}

async function addRepoAndActivateMainWorktree(
  page: Page,
  repoPath: string,
  featureWorktreePath: string
): Promise<WorktreeIds> {
  // Show external worktrees explicitly so the second fixture reaches the sidebar.
  const repoId = await page.evaluate(async (targetRepoPath) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const addedRepo = await store.getState().addRepoPath(targetRepoPath)
    if (!addedRepo) {
      throw new Error(`Failed to add repo at ${targetRepoPath}`)
    }
    await store.getState().updateRepo(addedRepo.id, { externalWorktreeVisibility: 'show' })
    return addedRepo.id
  }, repoPath)

  await expect
    .poll(
      () =>
        page.evaluate(async (targetRepoId) => {
          const store = window.__store
          if (!store) {
            return 0
          }
          await store.getState().fetchWorktrees(targetRepoId)
          return store.getState().worktreesByRepo[targetRepoId]?.length ?? 0
        }, repoId),
      { timeout: 20_000, message: 'proof repo worktrees did not load' }
    )
    .toBeGreaterThanOrEqual(2)

  return page.evaluate(
    ({ targetRepoId, targetRepoPath, targetFeaturePath }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      const worktrees = state.worktreesByRepo[targetRepoId] ?? []
      const mainWorktree = worktrees.find((entry) => entry.path === targetRepoPath)
      const featureWorktree = worktrees.find((entry) => entry.path === targetFeaturePath)
      if (!mainWorktree || !featureWorktree) {
        throw new Error(
          `Missing worktrees for ${targetRepoPath}: ${worktrees.map((entry) => entry.path).join(', ')}`
        )
      }

      state.setSidebarOpen(true)
      state.setGroupBy('none')
      state.setSortBy('recent')
      state.setShowActiveOnly(false)
      state.setShowSleepingWorkspaces(true)
      state.setHideDefaultBranchWorkspace(false)
      state.setFilterRepoIds([])
      state.setActiveRepo(targetRepoId)
      state.setActiveWorktree(mainWorktree.id)
      state.revealWorktreeInSidebar(featureWorktree.id, { behavior: 'auto' })
      return {
        repoId: targetRepoId,
        mainWorktreeId: mainWorktree.id,
        featureWorktreeId: featureWorktree.id
      }
    },
    {
      targetRepoId: repoId,
      targetRepoPath: realpathSync.native(repoPath),
      targetFeaturePath: realpathSync.native(featureWorktreePath)
    }
  )
}

test.describe('Setup script prompt', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
  })

  test('recovers from an unreadable topo.yaml instead of pinning the failed verdict', async ({
    electronApp,
    topoPage
  }, testInfo) => {
    const repoPath = testInfo.outputPath('unreadable-topo-yaml-repo')
    const featureWorktreePath = testInfo.outputPath('unreadable-topo-yaml-feature')
    createRepoWithSharedSetupScript(repoPath, featureWorktreePath)

    await installUnreadableTopoYamlFault(electronApp)
    const { repoId, featureWorktreeId } = await addRepoAndActivateMainWorktree(
      topoPage,
      repoPath,
      featureWorktreePath
    )

    const promptCard = topoPage.locator('[data-setup-script-prompt-layer]')
    const inspectionError = promptCard.getByText(INSPECTION_ERROR_TEXT)
    await expect(inspectionError).toBeVisible({ timeout: 20_000 })

    // topo.yaml is readable again; the card is still pinned to the failed verdict.
    await healTopoYamlRead(electronApp)
    const healthyCheck = await topoPage.evaluate(
      (targetRepoId) => window.api.hooks.check({ repoId: targetRepoId }),
      repoId
    )
    expect(healthyCheck.status).toBe('ok')
    expect((healthyCheck.hooks as { scripts?: { setup?: string } } | null)?.scripts?.setup).toBe(
      SETUP_SCRIPT_COMMAND
    )
    await expect(inspectionError).toBeVisible()
    await expect(promptCard.getByRole('button', { name: 'Retry' })).toBeVisible()
    // Not a wait for state: holds the pinned card on screen for the proof recording.
    await topoPage.waitForTimeout(RECORDING_DWELL_MS)

    // Activating another worktree in the same repo must re-inspect.
    const featureRow = worktreeRow(topoPage, featureWorktreeId)
    await expect(featureRow).toBeVisible()
    await worktreeRowSurface(topoPage, featureWorktreeId).click()
    await expect(featureRow).toHaveAttribute('aria-current', 'page')

    await expect(inspectionError).toBeHidden({ timeout: 20_000 })
    await expect(promptCard).toHaveCount(0)
    await topoPage.waitForTimeout(RECORDING_DWELL_MS)
  })
})
