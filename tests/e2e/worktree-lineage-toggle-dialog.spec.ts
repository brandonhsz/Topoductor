import { test, expect } from './helpers/topo-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { seedLineageScenario } from './worktree-lineage-state'

test.use({ launchEnv: { TOPO_BACKGROUND_LAUNCH: '1' } })

test('locally controlled project-group modal keeps child-toggle input', async ({
  topoPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  const family = await seedLineageScenario(topoPage)
  const groupId = await topoPage.evaluate(async ({ parentId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Missing store')
    }
    const parent = Object.values(store.getState().worktreesByRepo)
      .flat()
      .find((row) => row.id === parentId)
    if (!parent) {
      throw new Error('Missing parent')
    }
    const group = await store.getState().createProjectGroup('Shortcut dialog group', 'local')
    if (!group) {
      throw new Error('Missing project group')
    }
    const parentRepo = store.getState().repos.find((repo) => repo.id === parent.repoId)
    if (!parentRepo) {
      throw new Error('Missing parent repo')
    }
    await store.getState().moveProjectToGroup(parentRepo, group.id)
    store.getState().setGroupBy('repo')
    await store.getState().setKeybindingOverride('sidebar.childWorkspaces.toggle', ['Mod+Alt+H'])
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyH') {
        document.body.dataset.childToggleClaimed = String(event.defaultPrevented)
      }
    })
    return group.id
  }, family)
  const group = topoPage.locator(`[data-project-group-header-id="${groupId}"]`)
  await expect(
    topoPage
      .locator(
        `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(family.parentId)}]`
      )
      .first()
      .getByRole('button', { name: 'Hide 1 child workspace' })
  ).toBeVisible()
  await group.hover()
  await group.getByRole('button', { name: /Group actions/i }).click()
  // The menu is not a modal input owner.
  await topoPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  expect(await topoPage.evaluate(() => window.__store?.getState().collapsedGroups.size)).toBe(1)
  await topoPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  expect(await topoPage.evaluate(() => window.__store?.getState().collapsedGroups.size)).toBe(0)
  await topoPage.getByRole('menuitem', { name: /Delete/i }).click()
  const dialog = topoPage.getByRole('dialog', { name: 'Delete Project Group' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete Group', exact: true })).toBeFocused()
  expect(await topoPage.evaluate(() => window.__store?.getState().activeModal)).toBe('none')
  const before = await topoPage.evaluate(() =>
    [...(window.__store?.getState().collapsedGroups ?? [])].sort()
  )
  await topoPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  const proof = testInfo.outputPath('local-modal-guard.png')
  await topoPage.screenshot({ path: proof })
  await testInfo.attach('local-modal-guard', { path: proof, contentType: 'image/png' })
  expect(
    await topoPage.evaluate(() => [...(window.__store?.getState().collapsedGroups ?? [])].sort())
  ).toEqual(before)
  await expect(topoPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    topoPage
      .locator(
        `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(family.childId)}]`
      )
      .first()
  ).toBeVisible()
})
