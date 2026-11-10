import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => tmpdir(), getAppPath: () => tmpdir() }
}))
import {
  installLinuxBareTopoDispatcher,
  removeLinuxBareTopoDispatcher
} from './linux-bare-topo-dispatcher'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeProgram(path: string, output: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `#!/bin/sh\necho "${output} $*"\n`, 'utf8')
  await chmod(path, 0o755)
}

/** A home with Topo's dispatcher installed, and a second `topo` (as GNOME's screen reader). */
async function makeFixture(): Promise<{
  root: string
  homePath: string
  resourcesPath: string
  launcherPath: string
  dispatcherPath: string
  screenReaderDir: string
  toolsDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'topo bare dispatcher '))
  created.push(root)
  const homePath = join(root, 'home')
  const resourcesPath = join(root, 'resources')
  const launcherPath = join(resourcesPath, 'bin', 'topo-ide')
  const screenReaderDir = join(root, 'usr-bin')
  await writeProgram(launcherPath, 'TOPO_CLI')
  await writeProgram(join(screenReaderDir, 'topo'), 'SCREEN_READER')
  // Only bash on the base PATH, so a runner's own /usr/bin/topo cannot answer.
  const toolsDir = join(root, 'tools')
  await mkdir(toolsDir)
  const bash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim()
  await symlink(bash, join(toolsDir, 'bash'))
  const result = await installLinuxBareTopoDispatcher({
    resourcesPath,
    homePath,
    appImagePath: null
  })
  expect(result.state).toBe('installed')
  return {
    root,
    homePath,
    resourcesPath,
    launcherPath,
    dispatcherPath: result.dispatcherPath,
    screenReaderDir,
    toolsDir
  }
}

function runTopo(
  fixture: { homePath: string; toolsDir: string },
  pathDirs: string[],
  env: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('topo', ['status'], {
    encoding: 'utf8',
    env: { HOME: fixture.homePath, PATH: [...pathDirs, fixture.toolsDir].join(':'), ...env },
    timeout: 10_000
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe.runIf(process.platform !== 'win32')('the bare topo dispatcher as a shell runs it', () => {
  it("leaves another `topo` on PATH (GNOME's screen reader) to everyone but Topo's children", async () => {
    const fixture = await makeFixture()
    const binDir = join(fixture.homePath, '.local', 'bin')

    expect(runTopo(fixture, [binDir, fixture.screenReaderDir]).stdout).toBe(
      'SCREEN_READER status\n'
    )
    expect(
      runTopo(fixture, [binDir, fixture.screenReaderDir], { TOPO_PANE_KEY: 'tab:1' }).stdout
    ).toBe('TOPO_CLI status\n')
    expect(
      runTopo(fixture, [binDir, fixture.screenReaderDir], { TOPO_CLI_BIN_DIR: '/x' }).stdout
    ).toBe('TOPO_CLI status\n')
  })

  async function addSecondDispatcher(fixture: { root: string; dispatcherPath: string }) {
    const otherBin = join(fixture.root, 'other-home', '.local', 'bin')
    await mkdir(otherBin, { recursive: true })
    await writeFile(join(otherBin, 'topo'), await readFile(fixture.dispatcherPath, 'utf8'), {
      mode: 0o755
    })
    return otherBin
  }

  it.each(['TOPO_PANE_KEY', 'TOPO_CLI_BIN_DIR', 'TOPO_USER_DATA_PATH'])(
    'never starts the screen reader for Topo children (%s) once Topo is gone',
    async (variable) => {
      const fixture = await makeFixture()
      const otherBin = await addSecondDispatcher(fixture)
      await rm(fixture.resourcesPath, { recursive: true, force: true })

      const result = runTopo(
        fixture,
        [otherBin, join(fixture.homePath, '.local', 'bin'), fixture.screenReaderDir],
        { [variable]: 'set' }
      )
      expect(result.status).toBe(127)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Topo is no longer installed')
    }
  )

  it('never loops when the only other `topo` is another dispatcher', async () => {
    const fixture = await makeFixture()
    const otherBin = await addSecondDispatcher(fixture)
    await rm(fixture.resourcesPath, { recursive: true, force: true })

    const result = runTopo(fixture, [join(fixture.homePath, '.local', 'bin'), otherBin])
    expect(result.status).toBe(127)
    expect(result.stderr).toContain('Topo is no longer installed')
  })
})

describe.runIf(process.platform !== 'win32')('removing the bare topo dispatcher', () => {
  it("removes Topo's dispatcher and keeps a user's own `topo`", async () => {
    const fixture = await makeFixture()

    await expect(removeLinuxBareTopoDispatcher(fixture.homePath)).resolves.toBe(true)
    expect(existsSync(fixture.dispatcherPath)).toBe(false)
    await expect(removeLinuxBareTopoDispatcher(fixture.homePath)).resolves.toBe(false)

    await writeProgram(fixture.dispatcherPath, 'MINE')
    await expect(removeLinuxBareTopoDispatcher(fixture.homePath)).resolves.toBe(false)
    expect(await readFile(fixture.dispatcherPath, 'utf8')).toContain('MINE')
  })
})
