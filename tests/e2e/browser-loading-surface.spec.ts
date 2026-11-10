import { expect, test } from './helpers/topo-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  topoPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(topoPage)
  await ensureTerminalVisible(topoPage)
  await waitForActiveWorktree(topoPage)
  const observations = await observeBrowserLoadingSurface(
    topoPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
