import { writeFile } from 'node:fs/promises'
import { buildShellCommandFromArgv } from '../../src/shared/agent-launch/startup/tui-agent-startup-shell'
import { test, expect } from './helpers/topo-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('OMP spaced-colon title renders working and clears on idle', async ({
  topoPage
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'POSIX title replay; Windows formatter bytes have separate coverage'
  )
  await waitForSessionReady(topoPage)
  await waitForActiveWorktree(topoPage)
  await ensureTerminalVisible(topoPage)
  await waitForActiveTerminalManager(topoPage)
  const ptyId = await waitForActivePanePtyId(topoPage)
  const script = testInfo.outputPath('title-replay.cjs')
  await writeFile(
    script,
    `
process.stdout.write('\\x1b]0;OMP : Image review\\x07')
process.stdin.on('data', () => process.stdout.write('\\x1b]0;OMP > Image review\\x07'))
`
  )
  await execInTerminal(
    topoPage,
    ptyId,
    buildShellCommandFromArgv([process.execPath, script], 'posix')
  )
  const working = topoPage.locator('[aria-label="Working"]')
  await expect(working.first()).toBeVisible({ timeout: 15000 })
  await topoPage.screenshot({ path: testInfo.outputPath('omp-title-working.png') })
  await sendToTerminal(topoPage, ptyId, '\r')
  await expect(working).toHaveCount(0)
  await topoPage.screenshot({ path: testInfo.outputPath('omp-title-idle.png') })
})
