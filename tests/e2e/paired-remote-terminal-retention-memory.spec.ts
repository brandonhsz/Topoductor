import { test } from './helpers/topo-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedWebClient
} from './helpers/paired-electron-client'
import { runPairedTerminalParkingOracle } from './helpers/paired-terminal-parking-oracle'

test('ordinary-parks paired terminals and restores authoritative host scrollback @headful', async ({
  electronApp,
  topoPage
}) => {
  test.setTimeout(240_000)
  const seed = await topoPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktrees = state?.allWorktrees() ?? []
    const active = worktrees.find((worktree) => worktree.id === state?.activeWorktreeId)
    if (!active) {
      throw new Error('Paired retention host has no active seeded worktree')
    }
    return { activeWorktreeId: active.id, repoId: active.repoId }
  })
  const offer = await createRuntimeDesktopPairingOffer(topoPage)
  const client = await launchPairedWebClient(electronApp, offer, {
    terminalParkingDelayMs: 100
  })
  try {
    await runPairedTerminalParkingOracle(
      client.page,
      {
        fallbackWorktreeId: seed.activeWorktreeId,
        repoId: seed.repoId
      },
      { hostPage: topoPage }
    )
  } finally {
    await client.dispose()
  }
})
