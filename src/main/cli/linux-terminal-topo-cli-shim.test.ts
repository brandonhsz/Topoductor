import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@topo/process-host'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { resolveAppImageLauncherEndpointPath } from './appimage-stable-launcher'
import { ensureLinuxTerminalTopoCliShimDir } from './linux-terminal-topo-cli-shim'

const created: string[] = []
const canFenceAppImageRuntime = process.platform === 'linux'

async function makeFixture(): Promise<{ userDataPath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'topo-terminal-cli-shim-'))
  created.push(root)
  const resourcesPath = join(root, 'resources')
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'topo-ide'), '#!/usr/bin/env bash\n', 'utf8')
  return { userDataPath: join(root, 'user-data'), resourcesPath }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureLinuxTerminalTopoCliShimDir', () => {
  it('reuses the shim path and re-asserts its exec bit', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const options = { userDataPath, resourcesPath, appImagePath: null }

    const first = ensureLinuxTerminalTopoCliShimDir(options)
    expect(first).not.toBeNull()
    const shimPath = join(first!, 'topo')
    chmodSync(shimPath, 0o644)

    const second = ensureLinuxTerminalTopoCliShimDir(options)
    expect(second).toBe(first)
    expect(statSync(shimPath).mode & 0o111).not.toBe(0)

    const root = await mkdtemp(join(tmpdir(), 'topo-terminal-cli-shim-2-'))
    created.push(root)
    const otherUserData = join(root, 'user-data')
    mkdirSync(join(otherUserData, 'linux-topo-cli-shim'), { recursive: true })
    writeFileSync(join(otherUserData, 'linux-topo-cli-shim', 'topo'), 'stale contents', 'utf8')
    chmodSync(join(otherUserData, 'linux-topo-cli-shim', 'topo'), 0o644)

    const healed = ensureLinuxTerminalTopoCliShimDir({
      userDataPath: otherUserData,
      resourcesPath,
      appImagePath: null
    })
    expect(healed).not.toBeNull()
    const healedPath = join(healed!, 'topo')
    expect(readFileSync(healedPath, 'utf8')).toContain('topo-ide')
    expect(statSync(healedPath).mode & 0o111).not.toBe(0)
  })

  it.skipIf(!canFenceAppImageRuntime)(
    'routes first-use AppImage terminals through a fenced current mount without a live endpoint',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Topo.AppImage')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
      const cacheRootPath = join(userDataPath, 'cache')
      const liveLauncherPath = join(resourcesPath, 'bin', 'topo-ide')
      writeFileSync(liveLauncherPath, '#!/usr/bin/env bash\nprintf live', 'utf8')
      chmodSync(liveLauncherPath, 0o755)
      const shimDir = ensureLinuxTerminalTopoCliShimDir({
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      })

      const shimPath = join(shimDir!, 'topo')
      const content = readFileSync(shimPath, 'utf8')
      expect(content).toContain(liveLauncherPath)
      expect(content).not.toContain('/proc/')
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'live'))).toBe(false)
      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 0, stdout: 'live' })
    }
  )

  it.skipIf(!canFenceAppImageRuntime)(
    'refreshes restored terminals to the current AppImage mount',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Topo.AppImage')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
      const cacheRootPath = join(userDataPath, 'cache')
      const firstLauncher = join(resourcesPath, 'bin', 'topo-ide')
      writeFileSync(firstLauncher, '#!/usr/bin/env bash\nprintf first', 'utf8')
      chmodSync(firstLauncher, 0o755)
      const options = {
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      }
      const shimDir = ensureLinuxTerminalTopoCliShimDir(options)
      const shimPath = join(shimDir!, 'topo')
      const originalShim = readFileSync(shimPath, 'utf8')

      const nextResourcesPath = join(userDataPath, 'next-mount', 'resources')
      const nextLauncher = join(nextResourcesPath, 'bin', 'topo-ide')
      await mkdir(join(nextResourcesPath, 'bin'), { recursive: true })
      await writeFile(nextLauncher, '#!/usr/bin/env bash\nprintf next', { mode: 0o755 })
      await rm(firstLauncher)
      expect(
        ensureLinuxTerminalTopoCliShimDir({ ...options, resourcesPath: nextResourcesPath })
      ).toBe(shimDir)

      const refreshedShim = readFileSync(shimPath, 'utf8')
      expect(refreshedShim).not.toBe(originalShim)
      expect(refreshedShim).toContain(nextLauncher)
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'live'))).toBe(false)
      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 0, stdout: 'next' })
    }
  )

  it.skipIf(!canFenceAppImageRuntime)(
    'rejects a stale shim when its mount path is removed and reused',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Topo.AppImage')
      const cacheRootPath = join(userDataPath, 'cache')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
      const liveLauncher = join(resourcesPath, 'bin', 'topo-ide')
      writeFileSync(liveLauncher, '#!/usr/bin/env bash\nprintf original', { mode: 0o755 })
      const shimDir = ensureLinuxTerminalTopoCliShimDir({
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      })
      const shimPath = join(shimDir!, 'topo')
      await rm(liveLauncher)
      await writeFile(liveLauncher, '#!/usr/bin/env bash\nprintf replaced-by-another-mount', {
        mode: 0o755
      })

      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 1, stdout: '' })
    }
  )
})
