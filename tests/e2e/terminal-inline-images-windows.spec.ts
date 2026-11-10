import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/topo-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  assertInlineImagePixels,
  assertKittyPlaceholderPixels,
  enableInlineImages,
  inlineImagePayload
} from './helpers/terminal-inline-image-proof'
import { getFirstWslDistro, useWslRuntimeForActiveProject } from './helpers/wsl-golden-stub-agent'
import { nodeTerminalCommand } from './terminal-node-command'
import { proveWindowsKittyFileImage } from './helpers/terminal-kitty-file-image-proof'

test.skip(process.platform !== 'win32', 'Native Windows and WSL PTY coverage')

for (const runtime of ['native', 'wsl'] as const) {
  for (const acceleration of ['off', 'on'] as const) {
    test(`@headful ${runtime}, ${acceleration}: PTY images and Kitty placeholders render on Windows`, async ({
      topoPage,
      testRepoPath
    }, testInfo) => {
      await waitForSessionReady(topoPage)
      await ensureTerminalVisible(topoPage)
      await topoPage.evaluate(async (policy) => {
        await window.__store!.getState().updateSettings({ terminalGpuAcceleration: policy })
      }, acceleration)
      if (runtime === 'wsl') {
        const distro = await getFirstWslDistro(topoPage)
        expect(distro, 'This Windows verification requires an installed WSL distro').not.toBeNull()
        if (!distro) {
          throw new Error('No WSL distro available')
        }
        await useWslRuntimeForActiveProject(topoPage, distro)
      } else {
        await topoPage.evaluate(async () => {
          await window
            .__store!.getState()
            .updateSettings({ terminalWindowsShell: 'powershell.exe' })
        })
      }
      const tabId = await topoPage.evaluate(() => {
        const state = window.__store!.getState()
        const worktreeId = state.activeWorktreeId
        if (!worktreeId) {
          throw new Error('Missing verification worktree')
        }
        const tab = state.createTab(worktreeId)
        window.__store!.getState().setActiveTab(tab.id)
        window.__store!.getState().setActiveTabType('terminal', worktreeId)
        return tab.id
      })
      await expect(
        topoPage.locator(`[data-tab-id="${tabId}"] [data-shell-icon]`).first()
      ).toHaveAttribute('data-shell-icon', runtime === 'wsl' ? 'wsl.exe' : 'powershell.exe')
      await waitForActiveTerminalManager(topoPage, 30_000)
      await enableInlineImages(topoPage)
      await expect
        .poll(() =>
          topoPage.evaluate(() => {
            const tab = window.__store!.getState().activeTabId
            const manager = tab && window.__paneManagers?.get(tab)
            const pane = manager && manager.getActivePane()
            return Boolean(manager && pane && manager.hasWebglRenderer(pane.id))
          })
        )
        .toBe(acceleration === 'on')
      const ptyId = await waitForActivePanePtyId(topoPage)
      const marker = 'WINDOWS_INLINE_IMAGES_DONE'
      const rawPayload = `${inlineImagePayload(true)}${marker}\r\n`
      const payload = Buffer.from(rawPayload).toString('base64')
      // Stage a file: the command is typed before WSL bash reaches readline, where cooked TTY input truncates ~25KB lines at 4095 bytes.
      const payloadFile = `.topo-inline-images-${randomUUID()}.bin`
      if (runtime === 'wsl') {
        writeFileSync(path.join(testRepoPath, payloadFile), rawPayload)
      }
      const command =
        runtime === 'wsl'
          ? `cat ${payloadFile}; rm -f ${payloadFile}; printf 'WSL_IMAGE_PROTOCOL=%s\\n' "$TOPO_IMAGE_PROTOCOL"`
          : nodeTerminalCommand(['-e', `process.stdout.write(Buffer.from('${payload}', 'base64'))`])
      await execInTerminal(topoPage, ptyId, command)
      await waitForTerminalOutput(topoPage, marker, 30_000)
      if (runtime === 'wsl') {
        await waitForTerminalOutput(topoPage, 'WSL_IMAGE_PROTOCOL=kitty', 30_000)
      }
      await assertInlineImagePixels(topoPage, testInfo.outputPath('windows-inline-protocols.png'))
      await assertKittyPlaceholderPixels(
        topoPage,
        testInfo.outputPath('windows-inline-placeholders.png')
      )
      await proveWindowsKittyFileImage(
        topoPage,
        ptyId,
        runtime,
        testInfo.outputPath('windows-file-placeholders.png')
      )
    })
  }
}
