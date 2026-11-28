import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runAutomationPrecheck } from './precheck-runner'

vi.mock('../../shared/app-environment', () => ({
  hasAppEnvironment: () => true,
  getAppEnvironment: () => ({ isPackaged: () => true, getPath: () => '/tmp/topo-user-data' })
}))

vi.mock('../cli/topo-cli-child-path', () => ({
  prependTopoCliDirToChildPath: (env: Record<string, string>) => {
    env.TOPO_CLI_COMMAND = '/Applications/Topo.app/Contents/Resources/bin/topo'
    return env.TOPO_CLI_COMMAND
  }
}))

let cwd = ''
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

// Why: the Automatic ticket template's precheck runs `topo avenapm queue`, which needs the app's CLI.
it('runs a local precheck with this app’s CLI on PATH', async () => {
  cwd = mkdtempSync(join(tmpdir(), 'topo-precheck-cli-'))
  const node = JSON.stringify(process.execPath)
  const result = await runAutomationPrecheck({
    precheck: {
      command: `${node} -e "console.log(process.env.TOPO_CLI_COMMAND)"`,
      timeoutSeconds: 5
    },
    target: { type: 'local', cwd }
  })

  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim()).toBe('/Applications/Topo.app/Contents/Resources/bin/topo')
})
