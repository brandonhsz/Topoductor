import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type * as RecordFile from './topod-remote-record-file'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@topo/process-host'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('../../../shared/shell/launch/shell-argument-quoting', () => ({
  quotePosixShell: (s: string) => `'${s}'`
}))
vi.mock('./remote-install-lock', () => ({
  acquireInstallLock: vi.fn().mockResolvedValue(undefined),
  isRelayInstallLockStale: vi.fn().mockResolvedValue(false),
  RemoteInstallLockBusyError: class extends Error {},
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))
vi.mock('./remote-install-transfers', () => ({
  uploadRemoteInstallDirectory: vi.fn().mockResolvedValue(undefined),
  writeRemoteInstallFile: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./topod-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicTopodRemoteRecord: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./topod-remote-node-runtime', () => ({
  ensureRemoteTopodNodeRuntime: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./topod-local-build-hash', () => ({
  computeLocalTopodBuildHash: () => 'abc123def4567890'
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { isRelayInstallLockStale } from './remote-install-lock'
import { uploadRemoteInstallDirectory } from './remote-install-transfers'
import { writeAtomicTopodRemoteRecord } from './topod-remote-record-file'
import { deployTopod, type TopodDeployOptions } from './topod-remote-deploy'
import { installTopodBundle } from './topod-remote-install'
import { finalizeInstall } from './remote-versioned-install'
import {
  emptyTopodActivationRecord,
  withActivatedVersion
} from '../activation/topod-activation-record'

import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { isReadinessRead } from '../activation/topod-activation-host-test-harness'
import { isSnapshotCaptureCommand } from '../activation/testing/topod-snapshot-capture-command'
import { NODE_RUNTIME_PIN } from '../../../shared/node-runtime-pin'
import { serializeTopodActivationTransaction } from '../activation/topod-activation-transaction'
import { createTopodActivationTransaction } from '../activation/topod-activation-transaction-transitions'

const mockExec = vi.mocked(execCommand)
const NEW_VERSION = '0.2.0+bb0100000000'
const OLD_VERSION = '0.1.0+aa01'

vi.mock('./remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLocalFullVersion: () => '0.2.0+bb0100000000',
  isRemoteInstallComplete: vi.fn().mockResolvedValue(false),
  finalizeInstall: vi.fn().mockResolvedValue(undefined),
  abandonInstall: vi.fn().mockResolvedValue(undefined)
}))

function readyLine(overrides: {
  version?: string
  buildHash?: string
  daemonState?: 'live' | 'degraded' | 'absent'
  selfTestOk?: boolean
}): string {
  return JSON.stringify({
    type: 'topo_server_ready',
    schemaVersion: 1,
    runtimeId: 'r1',
    boundEndpoint: 'ws://127.0.0.1:7777',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
    health: {
      buildHash: overrides.buildHash ?? 'abc123def4567890',
      buildVersion: overrides.version ?? NEW_VERSION,
      nodeVersion: '20.11.0',
      nodeAbi: '115',
      platform: 'linux',
      arch: 'x64',
      pid: 1,
      terminalDaemon: {
        state: overrides.daemonState ?? 'live',
        ownsFreshSessions: (overrides.daemonState ?? 'live') === 'live',
        pid: 2,
        buildVersion: NEW_VERSION,
        entryPath: '/x/daemon-entry.js',
        protocolVersion: 3,
        selfTest: {
          ok: overrides.selfTestOk ?? true,
          coverage: 'pty-spawn',
          verdict: (overrides.selfTestOk ?? true) ? 'healthy' : 'pty-spawn-unhealthy',
          durationMs: 5
        }
      }
    }
  })
}

type HostScript = {
  activationRecord: string
  readiness: Record<string, string>
  log: string[]
  preflightResult?: string
  snapshotResult?: string
  comparisonResult?: string
  candidateStopResult?: string
  topodLog?: string
}

function scriptHost(script: HostScript): void {
  mockExec.mockImplementation(async (_conn, command: string) => {
    const text = String(command)
    if (text.startsWith('tail -c')) {
      return script.topodLog ?? ''
    }
    if (text.includes('__TOPOD_RECORD_PRESENT__') && text.includes('topod-active.json')) {
      return script.activationRecord
        ? `__TOPOD_RECORD_PRESENT__\n${script.activationRecord}`
        : '__TOPOD_RECORD_ABSENT__\n'
    }
    if (text.includes('__TOPOD_RECORD_PRESENT__') && text.includes('transaction.json')) {
      return '__TOPOD_RECORD_ABSENT__\n'
    }
    if (text.includes('__TOPOD_BUILD_HASH__')) {
      return '__TOPOD_BUILD_HASH__ abc123def4567890\n'
    }
    if (text.includes('topod.lock') && text.includes('topo-runtime.json')) {
      return 'CLEAR'
    }
    if (text.includes('.topod-readiness') && isReadinessRead(text)) {
      const version = Object.keys(script.readiness).find((v) => text.includes(v))
      return version ? script.readiness[version] : ''
    }
    if (text.includes('--topod-profile-state-preflight')) {
      script.log.push('preflight')
      return (
        script.preflightResult ??
        JSON.stringify({
          type: 'topo_profile_state_ready',
          nonce: text.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)?.[0],
          runtime: 'node',
          runtimeVersion: NODE_RUNTIME_PIN.version,
          sqliteVersion: '3.51.0',
          artifactVersion: NEW_VERSION,
          revision: 1
        })
      )
    }
    if (text.includes('nohup')) {
      script.log.push(`launch:${text.includes(NEW_VERSION) ? NEW_VERSION : OLD_VERSION}`)
      return '9999'
    }
    if (text.includes('kill -TERM')) {
      script.log.push(`stop:${text.includes(NEW_VERSION) ? NEW_VERSION : OLD_VERSION}`)
      return text.includes(NEW_VERSION) ? (script.candidateStopResult ?? 'STOPPED') : 'STOPPED'
    }
    if (isSnapshotCaptureCommand(text)) {
      script.log.push('snapshot')
      return script.snapshotResult ?? 'CAPTURED'
    }
    if (text.includes('verdict=UNCHANGED')) {
      script.log.push('compare-state')
      return script.comparisonResult ?? 'UNCHANGED'
    }
    return ''
  })
}

function options(overrides: Partial<TopodDeployOptions> = {}): TopodDeployOptions {
  const census = overrides.census ?? {
    liveSessions: 0,
    startedSinceActivation: 0,
    daemonProtocolVersion: 3
  }
  return {
    conn: Object.create(null),
    host: getRemoteHostPlatform('linux-x64'),
    remoteHome: '/home/u',
    localTopodDir: '/local/out/topod',
    target: 'linux-x64-glibc',
    nodePath: '/usr/bin/node',
    userDataDir: '/home/u/.topo',
    bindHost: '127.0.0.1',
    port: 7777,
    census,
    // An unchanged recount unless a test opens a terminal during the upload.
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    readinessTimeoutMs: 50,
    sleep: async () => {},
    now: () => new Date('2026-02-02T00:00:00.000Z'),
    ...overrides
  }
}

const ACTIVE_OLD = JSON.stringify(
  withActivatedVersion(emptyTopodActivationRecord(), OLD_VERSION, null, new Date(0))
)

describe('deployTopod', () => {
  it.each(['', '{"type":"topo_profile_state_ready","revision":0}'])(
    'leaves the incumbent and shared state alone when preflight returns %j',
    async (preflightResult) => {
      const script: HostScript = {
        activationRecord: ACTIVE_OLD,
        readiness: { [NEW_VERSION]: readyLine({}) },
        log: [],
        preflightResult
      }
      scriptHost(script)
      expect(await deployTopod(options())).toMatchObject({
        outcome: 'installed-not-activated',
        code: 'topod_candidate_preflight_failed',
        startCheckFailed: true
      })
      expect(script.log).toEqual(['preflight'])
      expect(
        vi
          .mocked(writeAtomicTopodRemoteRecord)
          .mock.calls.some(([, path]) => path.includes('topod-active.json'))
      ).toBe(false)
    }
  )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['a fresh fence with no journal', false, false, 'topod_activation_fence_busy'],
    ['a stale fence over a journal', true, true, 'topod_activation_recovery_required'],
    ['a fresh fence over a live run journal', false, true, 'topod_activation_fence_busy']
  ])('refuses before uploading on %s', async (_label, stale, journal, code) => {
    vi.mocked(isRelayInstallLockStale).mockResolvedValueOnce(stale)
    const JOURNAL = serializeTopodActivationTransaction(
      createTopodActivationTransaction({
        transactionId: '00000000-0000-4000-8000-000000000001',
        candidateVersion: NEW_VERSION,
        recordBefore: emptyTopodActivationRecord(),
        snapshotDirName: 'pre-1',
        now: new Date(0)
      })
    )
    mockExec.mockImplementation(async (_conn, command) => {
      const text = String(command)
      if (text.includes('echo LOCKED || echo OPEN')) {
        return 'LOCKED\n'
      }
      if (text.includes('__TOPOD_RECORD_ABSENT__') && text.includes('transaction.json')) {
        return journal ? `__TOPOD_RECORD_PRESENT__\n${JOURNAL}` : '__TOPOD_RECORD_ABSENT__\n'
      }
      return text.includes('__TOPOD_RECORD_ABSENT__') ? '__TOPOD_RECORD_ABSENT__\n' : ''
    })
    await expect(deployTopod(options())).resolves.toMatchObject({
      outcome: 'installed-not-activated',
      code
    })
    expect(uploadRemoteInstallDirectory).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32').each([undefined, 'linux-x64', 'linux-musl-x64'])(
    'restores uploaded executable modes with optional browser %s',
    async (browserTarget) => {
      const directory = mkdtempSync(join(tmpdir(), 'topod-install-modes-'))
      const binaries = ['ripgrep/linux-x64/rg']
      if (browserTarget) {
        binaries.push(`agent-browser-${browserTarget}`)
      }
      try {
        for (const filename of binaries) {
          const path = join(directory, filename)
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, 'uploaded executable')
          chmodSync(path, 0o644)
        }
        mockExec.mockImplementation(async (_conn, command) => {
          const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })
          if (result.code !== 0) {
            throw new Error(result.stderr)
          }
          return result.stdout
        })
        await installTopodBundle(
          {
            conn: options().conn,
            host: getRemoteHostPlatform('linux-x64'),
            localTopodDir: directory,
            target: 'linux-x64-musl',
            nodeRuntimeArchive: async () => '/cache/node.tar.gz'
          },
          NEW_VERSION,
          directory
        )
        expect(finalizeInstall).toHaveBeenCalledOnce()
        for (const filename of binaries) {
          expect(statSync(join(directory, filename)).mode & 0o777).toBe(0o755)
        }
      } finally {
        mockExec.mockReset()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it('activates a healthy candidate and records the outgoing version as the rollback target', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: { [NEW_VERSION]: readyLine({}) },
      log: []
    }
    scriptHost(script)
    const result = await deployTopod(options())
    expect(result).toMatchObject({ outcome: 'installed-and-activated', fullVersion: NEW_VERSION })
    const written = vi
      .mocked(writeAtomicTopodRemoteRecord)
      .mock.calls.find((call) => String(call[1]).endsWith('topod-active.json'))
    expect(JSON.parse(String(written?.[2]))).toMatchObject({
      active: NEW_VERSION,
      previous: OLD_VERSION
    })
  })

  it('treats the census as unverifiable when another incumbent lands mid-upload', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: { [NEW_VERSION]: readyLine({}) },
      log: []
    }
    scriptHost(script)
    const counted = JSON.parse(ACTIVE_OLD)
    // A same-app-line peer activation passes version admission; census binding must catch the changed incumbent.
    const peer = withActivatedVersion(counted, '0.1.5+dd01', null, new Date(5), '1.4.0')
    vi.mocked(uploadRemoteInstallDirectory).mockImplementationOnce(async () => {
      script.activationRecord = JSON.stringify(peer)
    })
    expect(
      await deployTopod(options({ censusRecord: counted, admitRecord: () => null }))
    ).toMatchObject({
      outcome: 'installed-not-activated',
      code: 'topod_update_terminal_census_unavailable'
    })
    expect(script.log).toEqual([])
  })

  it('installs but does not activate when terminals are running', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: { [NEW_VERSION]: readyLine({}) },
      log: []
    }
    scriptHost(script)
    const result = await deployTopod(
      options({ census: { liveSessions: 2, startedSinceActivation: 0, daemonProtocolVersion: 3 } })
    )
    expect(result).toMatchObject({
      outcome: 'installed-not-activated',
      code: 'topod_update_terminals_running',
      freshlyInstalled: true
    })
    // A deferral keeps its staged build for the later update.
    expect(result).not.toHaveProperty('startCheckFailed')
    // Uploading bytes must not mutate a refused incumbent.
    expect(vi.mocked(uploadRemoteInstallDirectory)).toHaveBeenCalled()
    expect(script.log).toEqual([])
  })

  it('does not write the activation record when the candidate fails its health gate', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: { [NEW_VERSION]: readyLine({ daemonState: 'degraded' }) },
      log: [],
      topodLog: 'daemon: starting\ndaemon: socket bind failed: EACCES\n'
    }
    scriptHost(script)
    const result = await deployTopod(options())
    expect(result).toMatchObject({ code: 'topod_activation_daemon_degraded' })
    // Report the candidate failure itself, not just its log path.
    expect(result).toMatchObject({
      reason: expect.stringMatching(/Last lines of topod\.log:\ndaemon: starting\n.*EACCES$/u)
    })
    expect(
      vi
        .mocked(writeAtomicTopodRemoteRecord)
        .mock.calls.some((call) => String(call[1]).endsWith('topod-active.json'))
    ).toBe(false)
  })

  it('puts the previous version back after a rejected candidate, rather than leaving the host down', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: {
        [NEW_VERSION]: readyLine({ selfTestOk: false }),
        [OLD_VERSION]: readyLine({ version: OLD_VERSION })
      },
      log: []
    }
    scriptHost(script)
    const result = await deployTopod(options())
    expect(result).toMatchObject({ startCheckFailed: true, freshlyInstalled: true })
    expect(script.log).toEqual([
      'preflight',
      `stop:${OLD_VERSION}`,
      'snapshot',
      `launch:${NEW_VERSION}`,
      `stop:${NEW_VERSION}`,
      'compare-state',
      `launch:${OLD_VERSION}`
    ])
    expect(result.outcome === 'installed-not-activated' && result.reason).toContain(
      `topod ${OLD_VERSION} was restarted and is serving again`
    )
  })

  it.each(['CHANGED', 'UNKNOWN', ''])(
    'preserves rejected candidate state when comparison is %s',
    async (comparisonResult) => {
      const script: HostScript = {
        activationRecord: ACTIVE_OLD,
        readiness: { [NEW_VERSION]: readyLine({ selfTestOk: false }) },
        log: [],
        comparisonResult
      }
      scriptHost(script)

      const result = await deployTopod(options())

      expect(result).toMatchObject({ outcome: 'installed-not-activated' })
      expect(script.log).toEqual([
        'preflight',
        `stop:${OLD_VERSION}`,
        'snapshot',
        `launch:${NEW_VERSION}`,
        `stop:${NEW_VERSION}`,
        'compare-state'
      ])
      expect(result.outcome === 'installed-not-activated' && result.reason).toContain(
        'Recover to restore the prelaunch snapshot'
      )
      expect(result.outcome === 'installed-not-activated' && result.reason).toContain(
        '/home/u/.topo-remote/topod-state-snapshots/'
      )
      expect(mockExec.mock.calls.some(([, command]) => command.includes('echo RESTORED'))).toBe(
        false
      )
    }
  )

  it('restarts the incumbent when a quiescent snapshot cannot be captured', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: { [OLD_VERSION]: readyLine({ version: OLD_VERSION }) },
      log: [],
      snapshotResult: 'SNAPSHOT_FAILURE tar: Cannot write: No space left on device\nFAILED'
    }
    scriptHost(script)

    await expect(deployTopod(options())).rejects.toThrow(
      /activating \S+: tar: Cannot write: No space left on device\. .*incumbent was stopped/u
    )
    expect(script.log).toEqual([
      'preflight',
      `stop:${OLD_VERSION}`,
      'snapshot',
      `launch:${OLD_VERSION}`
    ])
  })

  it('refuses to activate when a different build answered the port', async () => {
    const script: HostScript = {
      activationRecord: ACTIVE_OLD,
      readiness: {
        [NEW_VERSION]: readyLine({ buildHash: 'deadbeefdeadbeef' }),
        [OLD_VERSION]: readyLine({ version: OLD_VERSION })
      },
      log: []
    }
    scriptHost(script)
    const result = await deployTopod(options())
    expect(result).toMatchObject({ code: 'topod_activation_build_mismatch' })
  })

  it('refuses to treat an unreadable activation record as an empty one', async () => {
    const script: HostScript = {
      activationRecord: JSON.stringify({ schemaVersion: 99, active: 'x' }),
      readiness: { [NEW_VERSION]: readyLine({}) },
      log: []
    }
    scriptHost(script)
    await expect(deployTopod(options())).rejects.toThrow('activation record')
    expect(vi.mocked(uploadRemoteInstallDirectory)).not.toHaveBeenCalled()
  })
})
