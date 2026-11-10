import { test, expect } from './helpers/topo-app'

test.use({ dismissOnboarding: false, seedTestRepo: false })

test('Retry recovers a rejected language catalog request without reloading', async ({
  electronApp,
  topoPage
}, testInfo) => {
  await topoPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Renderer store unavailable')
    }
    const settings = await window.api.settings.get()
    if (!settings.telemetry) {
      throw new Error('Telemetry settings unavailable')
    }
    await store.getState().updateSettingsOrThrow({
      uiLanguage: 'en',
      telemetry: { ...settings.telemetry, onboardingLanguageCohort: 'treatment' }
    })
  })
  await topoPage.getByRole('button', { name: 'Switch language' }).click()
  await expect(topoPage.getByRole('radio', { name: '日本語', exact: true })).toBeVisible()

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(details.url) })
    })
  })
  const timeOrigin = await topoPage.evaluate(() => performance.timeOrigin)
  const rejected = topoPage.waitForEvent('requestfailed', {
    predicate: (request) => /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(request.url())
  })
  await topoPage.getByRole('radio', { name: '日本語', exact: true }).click()
  const failedRequest = await rejected
  await expect(topoPage.getByRole('alert')).toContainText('Could not load this language')
  await expect(topoPage.getByRole('radio', { name: 'English', exact: true })).toBeChecked()
  await topoPage.screenshot({ path: testInfo.outputPath('catalog-request-rejected.png') })

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(null)
  })
  expect(
    await topoPage.evaluate(async (url) => (await fetch(url)).status, failedRequest.url())
  ).toBe(200)
  await topoPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(topoPage.getByRole('radio', { name: '日本語', exact: true })).toBeChecked()
  await expect(topoPage.getByRole('radiogroup', { name: '表示言語', exact: true })).toBeVisible()
  await expect(topoPage.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(() => topoPage.evaluate(() => window.api.settings.get().then((s) => s.uiLanguage)))
    .toBe('ja')
  expect(await topoPage.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await topoPage.screenshot({ path: testInfo.outputPath('catalog-retry-recovered.png') })
})
