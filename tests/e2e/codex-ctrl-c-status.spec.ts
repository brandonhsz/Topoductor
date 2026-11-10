import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildShellCommandFromArgv,
  resolveStartupShell
} from '../../src/shared/agent-launch/startup/tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from '../../src/shared/windows-terminal-shell'
import { test, expect } from './helpers/topo-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  execInTerminal,
  waitForActivePanePtyId,
  waitForTerminalOutput,
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager
} from './helpers/terminal'

// Replay navigation input through a real PTY; hook and rollout fixtures own agent status.
for (const navigation of ['Control+c', 'F3 search', '/permissions'] as const) {
  test(`Codex ${navigation} preserves working status until a confirmed interruption`, async ({
    topoPage,
    electronApp
  }, testInfo) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
    await waitForActiveTerminalManager(topoPage, 30_000)
    const endpoint = await readHookEndpoint(electronApp)
    const descriptor = await waitForActivePaneHookDescriptor(topoPage)
    await topoPage.evaluate(() => {
      const state = window.__store?.getState()
      state?.setAgentActivityDisplayMode('full')
      if (state && !state.worktreeCardProperties.includes('inline-agents')) {
        state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
      }
    })
    const dir = mkdtempSync(join(tmpdir(), 'topo-codex-interruption-'))
    const transcriptPath = join(dir, 'rollout-root.jsonl')
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } })}\n`
    )
    try {
      const inputScript = join(dir, 'codex-input.cjs')
      writeFileSync(
        inputScript,
        `
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes(3)) process.stdout.write('TOPO_CTRL_C_RECEIVED\\n')
  if (chunk.toString() === '\\x1bOR' || chunk.toString() === '\\x1b[13~') {
    process.stdout.write('TOPO_F3_SEARCH_OPENED\\n')
  }
  if (chunk.includes(13)) process.stdout.write('TOPO_PERMISSIONS_OPENED\\n')
  if (chunk.toString() === '\\x1b') process.stdout.write('TOPO_ESCAPE_RECEIVED: view dismissed; main task continues\\n')
})
process.stdout.write('TOPO_CODEX_INPUT_READY\\n')
`
      )
      const terminalWindowsShell = await topoPage.evaluate(
        () => window.__store?.getState().settings?.terminalWindowsShell
      )
      const shell = resolveStartupShell(
        process.platform,
        resolveLocalWindowsAgentStartupShell({
          platform: process.platform,
          isRemote: false,
          terminalWindowsShell
        })
      )
      const ptyId = await waitForActivePanePtyId(topoPage)
      await execInTerminal(
        topoPage,
        ptyId,
        buildShellCommandFromArgv([process.execPath, inputScript], shell)
      )
      await waitForTerminalOutput(topoPage, 'TOPO_CODEX_INPUT_READY')
      await emitCodexHookStatus(endpoint, {
        ...descriptor,
        transcriptPath,
        sessionId: 'main-session',
        state: 'working',
        prompt: 'Main task continues'
      })
      const working = topoPage.locator('[aria-label="Working"]')
      const interrupted = topoPage.locator('[aria-label="Interrupted"]')
      await expect(working.first()).toBeVisible()
      await emitCodexHookStatus(endpoint, {
        ...descriptor,
        state: 'working',
        sessionId: 'side-session',
        transcriptPath: null,
        prompt: 'Side chat'
      })
      await expect(topoPage.getByText('Main task continues', { exact: true })).toBeVisible()
      await focusActiveTerminalInput(topoPage)
      const key = navigation === 'Control+c' ? 'Control+c' : 'Escape'
      if (navigation === 'F3 search') {
        await topoPage.keyboard.press('F3')
        await waitForTerminalOutput(topoPage, 'TOPO_F3_SEARCH_OPENED')
      } else if (navigation === '/permissions') {
        await topoPage.keyboard.type('/permissions')
        await topoPage.keyboard.press('Enter')
        await waitForTerminalOutput(topoPage, 'TOPO_PERMISSIONS_OPENED')
      }
      await topoPage.keyboard.press(key)
      await waitForTerminalOutput(
        topoPage,
        key === 'Escape' ? 'TOPO_ESCAPE_RECEIVED' : 'TOPO_CTRL_C_RECEIVED'
      )
      // Allow the old 500 ms inference timer to fire before recording the rendered result.
      await topoPage.waitForTimeout(1_000)
      await topoPage.screenshot({
        path: testInfo.outputPath('status-after-input.png')
      })
      await expect(interrupted).toHaveCount(0)
      await expect(working.first()).toBeVisible()

      appendFileSync(
        transcriptPath,
        `${JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-1', reason: 'interrupted' } })}\n`
      )
      await expect(interrupted.first()).toBeVisible()
      await expect(working).toHaveCount(0)
      await topoPage.screenshot({
        path: testInfo.outputPath('status-after-confirmed-interruption.png')
      })
      await emitCodexHookStatus(endpoint, {
        ...descriptor,
        state: 'working',
        prompt: 'Next main task'
      })
      await expect(working.first()).toBeVisible()
      await expect(interrupted).toHaveCount(0)
      await emitCodexHookStatus(endpoint, { ...descriptor, state: 'done' })
      await expect(working).toHaveCount(0)
      await expect(interrupted).toHaveCount(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
