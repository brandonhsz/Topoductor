import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import type * as RecordFile from '../install/topod-remote-record-file'
import type * as InstallLock from '../install/remote-install-lock'
import type * as VersionedInstall from '../install/remote-versioned-install'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('../../../shared/shell/launch/shell-argument-quoting', () => ({
  quotePosixShell: (s: string) => `'${s}'`
}))
vi.mock('../install/remote-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn()
}))
vi.mock('../install/topod-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicTopodRemoteRecord: vi.fn()
}))
vi.mock('../install/remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<typeof VersionedInstall>()),
  readLocalFullVersion: () => '0.2.0+bb01'
}))
vi.mock('../install/topod-remote-install', () => ({ installTopodBundle: vi.fn() }))
vi.mock('../install/topod-remote-preflight', () => ({
  preflightInstalledTopod: vi.fn(async () => ({}))
}))
vi.mock('../install/topod-local-build-hash', () => ({
  computeLocalTopodBuildHash: () => 'abc123def4567890'
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { acquireInstallLock } from '../install/remote-install-lock'
import { writeAtomicTopodRemoteRecord } from '../install/topod-remote-record-file'
import { deployTopod } from '../install/topod-remote-deploy'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { TOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE } from './topod-snapshot-room'

import { TopodFenceLostError } from '../activation/topod-activation-fence-scope'

import { FakeTopodHost, NEW, OLD } from '../activation/topod-activation-host-test-harness'

let host = FakeTopodHost.deployedOld()

function answerRoom(neededKb: number, reclaimKb: number, availableKb: number): void {
  vi.mocked(execCommand).mockImplementation(async (_conn, command) =>
    command.includes('SNAPSHOT_SPACE')
      ? `SNAPSHOT_SPACE ${neededKb} ${reclaimKb} /dev/sda1 100 1 ${availableKb} 1% /home\n`
      : host.exec(command)
  )
}

const IDLE = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 3 }
const deploy = (extra: Partial<Parameters<typeof deployTopod>[0]> = {}) =>
  deployTopod({
    conn: Object.create(null),
    host: getRemoteHostPlatform('linux-x64'),
    remoteHome: '/home/work',
    nodePath: '/usr/bin/node',
    userDataDir: '/home/work/.topo',
    bindHost: '127.0.0.1',
    port: 7777,
    readinessTimeoutMs: 50,
    sleep: async () => {},
    now: () => new Date('2026-02-02T00:00:00.000Z'),
    localTopodDir: '/local/out/topod',
    target: 'linux-x64-glibc217',
    census: IDLE,
    recountCensus: async () => extra.census ?? IDLE,
    releaseIncumbentAdmission: async () => {},
    ...extra
  })

beforeEach(() => {
  vi.clearAllMocks()
  host = FakeTopodHost.deployedOld()
  vi.mocked(acquireInstallLock).mockImplementation(async (_conn, dir, _host, options) => {
    if (!host.acquireFence(options)) {
      const { RemoteInstallLockBusyError } = await vi.importActual<typeof InstallLock>(
        '../install/remote-install-lock'
      )
      throw new RemoteInstallLockBusyError(dir, 0)
    }
  })
  vi.mocked(writeAtomicTopodRemoteRecord).mockImplementation(async (_target, path, contents) =>
    host.write(path, contents)
  )
})

describe('an update on a host without room for its snapshot (#30491)', () => {
  it('keeps the running server and says how much to free, stopping nothing', async () => {
    answerRoom(400_000, 0, 1_000)

    const result = await deploy()

    expect(result).toMatchObject({
      outcome: 'installed-not-activated',
      code: TOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE
    })
    expect(JSON.stringify(result)).toMatch(
      /has 1000 KB free, and the snapshot needs about 390\.6 MB.*left the current server \(0\.1\.0\+aa01\) in place/u
    )
    expect([...host.alive]).toEqual([OLD])
    expect(host.activeVersion()).toBe(OLD)
    expect(host.commands.some((command) => command.includes('kill -TERM'))).toBe(false)
    expect(host.journal).toBeNull()
    expect(host.fence).toBe(false)
  })

  it('goes ahead when the room probe loses its channel, leaving the capture to decide', async () => {
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('SNAPSHOT_SPACE')) {
        throw Object.assign(new Error('lost'), { sshChannelCloseConfirmed: false })
      }
      return host.exec(command)
    })

    expect(await deploy()).toMatchObject({ outcome: 'installed-and-activated' })
    expect(host.activeVersion()).toBe(NEW)
  })

  it('still stops on a lost fence from the room probe', async () => {
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('SNAPSHOT_SPACE')) {
        throw Object.assign(new Error('fence lost'), {
          exitCode: 75,
          stdout: '__TOPOD_FENCE_LOST__\n'
        })
      }
      return host.exec(command)
    })

    await expect(deploy()).rejects.toBeInstanceOf(TopodFenceLostError)
    expect([...host.alive]).toEqual([OLD])
    expect(host.commands.some((command) => command.includes('kill -TERM'))).toBe(false)
  })

  it('updates when pruning earlier snapshots makes the room', async () => {
    answerRoom(400_000, 500_000, 1_000)

    expect(await deploy()).toMatchObject({ outcome: 'installed-and-activated' })
    expect(host.activeVersion()).toBe(NEW)
  })
})
