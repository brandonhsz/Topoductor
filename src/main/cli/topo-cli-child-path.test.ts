import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'

const shim = vi.hoisted(() => ({ ensureLinuxTerminalTopoCliShimDir: vi.fn() }))
vi.mock('./linux-terminal-topo-cli-shim', () => shim)

import { prependTopoCliDirToChildPath } from './topo-cli-child-path'

const USER_DATA = '/data/topo'
const SHIM_DIR = join(USER_DATA, 'linux-topo-cli-shim')

beforeEach(() => {
  installFakeAppEnvironment()
  shim.ensureLinuxTerminalTopoCliShimDir.mockReset()
  shim.ensureLinuxTerminalTopoCliShimDir.mockReturnValue(SHIM_DIR)
})

afterEach(() => installFakeAppEnvironment())

describe('prependTopoCliDirToChildPath', () => {
  it.each(['linux', 'darwin'] as const)(
    'uses the %s execution host CLI and profile over inherited values',
    (platform) => {
      const launcher = join(USER_DATA, 'cli', 'bin', 'topo')
      installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
      const env: Record<string, string> = {
        PATH: `/usr/bin:${join(USER_DATA, 'cli', 'bin')}::/bin`,
        TOPO_USER_DATA_PATH: '/parent/profile',
        TOPO_CLI_COMMAND: '/parent/topo',
        TOPO_CLI_BIN_DIR: '/parent/bin'
      }
      expect(
        prependTopoCliDirToChildPath(env, {
          isPackaged: true,
          userDataPath: USER_DATA,
          resourcesPath: null,
          platform
        })
      ).toBe(launcher)
      expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}:/usr/bin:/bin`)
      expect(env.TOPO_USER_DATA_PATH).toBe(USER_DATA)
      expect(env.TOPO_CLI_COMMAND).toBe(launcher)
      expect(env.TOPO_CLI_BIN_DIR).toBe(join(USER_DATA, 'cli', 'bin'))
      expect(shim.ensureLinuxTerminalTopoCliShimDir).not.toHaveBeenCalled()
    }
  )
  it('exports the owning packaged Linux launcher and profile together with PATH', () => {
    const env = {
      PATH: `/usr/bin:${SHIM_DIR}::/bin`,
      TOPO_CLI_COMMAND: '/other/topo',
      TOPO_USER_DATA_PATH: '/other/profile'
    }
    const launcher = prependTopoCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      platform: 'linux'
    })

    expect(launcher).toBe(join(SHIM_DIR, 'topo'))
    expect(env.TOPO_CLI_COMMAND).toBe(launcher)
    expect(env.TOPO_USER_DATA_PATH).toBe(USER_DATA)
    expect(env.PATH).toBe(`${SHIM_DIR}:/usr/bin:/bin`)
  })

  it('puts a Windows execution host CLI first on Path without a POSIX restore dir', () => {
    const binDir = join(USER_DATA, 'cli', 'bin')
    const launcher = join(binDir, 'topo.exe')
    installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
    const env: Record<string, string> = {
      Path: `C:\\Windows;${binDir};;C:\\Tools`,
      TOPO_USER_DATA_PATH: 'C:\\parent\\profile',
      TOPO_CLI_COMMAND: 'C:\\parent\\topo.exe',
      TOPO_CLI_BIN_DIR: '/parent/bin'
    }
    expect(
      prependTopoCliDirToChildPath(env, {
        isPackaged: true,
        userDataPath: USER_DATA,
        resourcesPath: null,
        platform: 'win32'
      })
    ).toBe(launcher)
    expect(env).toEqual({
      Path: `${binDir};C:\\Windows;C:\\Tools`,
      TOPO_USER_DATA_PATH: USER_DATA,
      TOPO_CLI_COMMAND: launcher
    })
  })

  it('writes no trailing delimiter when nothing was inherited', () => {
    const env: Record<string, string> = { PATH: '' }
    const inheritedPath = process.env.PATH
    delete process.env.PATH
    try {
      prependTopoCliDirToChildPath(env, {
        isPackaged: false,
        userDataPath: USER_DATA,
        platform: 'linux'
      })
    } finally {
      if (inheritedPath !== undefined) {
        process.env.PATH = inheritedPath
      }
    }
    // Why: an empty trailing segment resolves as `.` in some shells.
    expect(env.PATH).toBe(join(USER_DATA, 'cli', 'bin'))
  })
})
