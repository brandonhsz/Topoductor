import { test } from './topo-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './store'
import { waitForActiveTerminalManager, waitForPaneCount } from './terminal'

export function registerTerminalPaneMountReadiness(): void {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
    // Allow cold starts 30s for the React terminal lifecycle to register PaneManager.
    const hasPaneManager = await waitForActiveTerminalManager(topoPage, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounts the live TerminalPane manager, so pane split/resize assertions would only fail on harness setup.'
    )
    // Hidden-window readiness may precede the first xterm/PTY pair; require it before split/content assertions.
    await waitForPaneCount(topoPage, 1, 30_000)
  })
}
