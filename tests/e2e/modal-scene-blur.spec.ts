import { test, expect } from './helpers/topo-app'
import { openSidebarProjectDialog } from './helpers/sidebar-project-dialog'

test.use({ seedTestRepo: false, topoAppExtraEnv: { TOPO_BACKGROUND_LAUNCH: '1' } })

for (const theme of ['dark', 'light'] as const) {
  test(`modal surfaces blur the live scene and stay sharp (${theme})`, async ({
    electronApp,
    topoPage
  }, testInfo) => {
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused()
      }))
    )
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
    await topoPage.evaluate(async (theme) => {
      await window.__store?.getState().updateSettings({ theme, uiLanguage: 'en' })
    }, theme)

    const scene = topoPage.locator('.app-layout > :first-child')
    await expect(scene).toHaveCSS('filter', 'none')
    await openSidebarProjectDialog(topoPage)
    await expect(scene).toHaveCSS('filter', 'blur(2px)')
    await expect(topoPage.locator('.app-layout')).toHaveCSS('filter', 'none')
    const dialog = topoPage.getByRole('dialog', { name: /Add a project/i })
    await expect(dialog).toHaveCSS('filter', 'none')
    await expect(dialog).toHaveCSS('backdrop-filter', 'none')
    await expect(topoPage.locator('[data-slot="dialog-overlay"]')).toHaveCSS(
      'backdrop-filter',
      'none'
    )
    await topoPage.screenshot({ path: testInfo.outputPath(`dialog-blur-${theme}.png`) })
    await topoPage.keyboard.press('Escape')
    await expect(scene).toHaveCSS('filter', 'none')

    await topoPage.getByRole('button', { name: 'Search worktrees and browser tabs' }).click()
    const palette = topoPage.locator('[data-slot="command-dialog-content"]')
    await expect(palette).toBeVisible()
    await expect(scene).toHaveCSS('filter', 'blur(2px)')
    await expect(palette).toHaveCSS('filter', 'none')
    await expect(palette).toHaveCSS('backdrop-filter', 'none')
    await topoPage.keyboard.press('Escape')
    await expect(scene).toHaveCSS('filter', 'none')
  })
}

test('Space window dialogs blur their scene and release it on close', async ({
  electronApp,
  topoPage
}, testInfo) => {
  const spaceWindow = electronApp.waitForEvent('window')
  await topoPage.evaluate(async () => {
    await window.api.workspaceSpace.openWindow?.()
  })
  const spacePage = await spaceWindow
  await spacePage.waitForFunction(() => Boolean(window.__store))
  const scene = spacePage.locator('.app-layout > :first-child')
  await expect(scene).toHaveCSS('filter', 'none')
  await spacePage.evaluate(() => {
    window.__store?.getState().openModal('preserved-branch-review', {
      branches: [{ worktreeId: 'blur-preview', branchName: 'preview' }]
    })
  })
  const dialog = spacePage.getByRole('dialog', { name: 'Review kept branches' })
  await expect(dialog).toBeVisible()
  await expect(scene).toHaveCSS('filter', 'blur(2px)')
  await expect(dialog).toHaveCSS('filter', 'none')
  await expect(dialog).toHaveCSS('backdrop-filter', 'none')
  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  await spacePage.screenshot({ path: testInfo.outputPath('space-dialog-blur.png') })
  await spacePage.keyboard.press('Escape')
  await expect(scene).toHaveCSS('filter', 'none')
})

test.describe('onboarding scene blur', () => {
  test.use({ dismissOnboarding: false })

  test('onboarding stays sharp until a nested confirmation opens', async ({ topoPage }) => {
    const scene = topoPage.locator('.app-layout > :first-child')
    const onboarding = topoPage.locator('[data-onboarding-overlay]')
    await expect(onboarding).toBeVisible()
    await expect(scene).toHaveCSS('filter', 'blur(2px)')
    await expect(onboarding).toHaveCSS('filter', 'none')
    await expect(onboarding).toHaveCSS('backdrop-filter', 'none')
    await onboarding.getByRole('button').first().focus()
    await topoPage.keyboard.press('Escape')
    const confirmation = topoPage.getByRole('dialog', { name: /Skip onboarding\?/i })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toHaveCSS('filter', 'none')
    await expect(onboarding).toHaveCSS('filter', 'blur(2px)')
    await confirmation.getByRole('button', { name: /No, keep going/i }).click()
    await expect(onboarding).toHaveCSS('filter', 'none')
    await expect(scene).toHaveCSS('filter', 'blur(2px)')
  })

  test('onboarding render recovery stays within the viewport', async ({ topoPage }, testInfo) => {
    await expect(topoPage.locator('[data-onboarding-overlay]')).toBeVisible()
    await topoPage.evaluate(async () => {
      const onboarding = await window.api.onboarding.get()
      Object.defineProperty(onboarding, 'lastCompletedStep', {
        get() {
          throw new Error('Injected onboarding render failure')
        }
      })
      window.dispatchEvent(new CustomEvent('topo:onboarding-reopened', { detail: onboarding }))
    })

    const crashReport = topoPage.getByRole('dialog').filter({
      has: topoPage.getByRole('heading', { name: 'Topo hit a recoverable UI error' })
    })
    await crashReport.getByRole('button', { name: 'Close', exact: true }).click()
    const recovery = topoPage.getByRole('alert').filter({ hasText: 'Onboarding hit an error.' })
    const retry = recovery.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeInViewport()
    await topoPage.screenshot({ path: testInfo.outputPath('onboarding-render-recovery.png') })

    await topoPage.evaluate(async () => {
      window.dispatchEvent(
        new CustomEvent('topo:onboarding-reopened', { detail: await window.api.onboarding.get() })
      )
    })
    await retry.click()
    await expect(recovery).toHaveCount(0)
    await expect(topoPage.locator('[data-onboarding-overlay]')).toBeVisible()
    await expect(topoPage.locator('.app-layout > :first-child')).toHaveCSS('filter', 'blur(2px)')
  })
})
