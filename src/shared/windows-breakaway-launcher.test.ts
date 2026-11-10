import { describe, expect, it } from 'vitest'

import {
  TOPOD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_EXIT_CODES as RELAY_WINDOWS_BREAKAWAY_EXIT_CODES,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG as RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  type WindowsBreakawayLaunchContract
} from './windows-breakaway-launch'
import {
  launchOutsideJob,
  parseWindowsBreakawayLaunchRequest,
  type SpawnOutsideJob,
  type WindowsBreakawayLauncher
} from './windows-breakaway-launcher'

// The launcher is contract-agnostic; this stands in for the retired relay's contract.
const RELAY_WINDOWS_BREAKAWAY_CONTRACT: WindowsBreakawayLaunchContract = {
  argsFlag: '--relay-args',
  reportMarker: 'TOPO_RELAY_LAUNCH'
}

const parseRelayWindowsBreakawayLaunch = (args: readonly string[]) =>
  parseWindowsBreakawayLaunchRequest(RELAY_WINDOWS_BREAKAWAY_CONTRACT, args)

function launcherFor(
  spawn: SpawnOutsideJob,
  creationTimeMs: number | null = null
): WindowsBreakawayLauncher {
  return { spawnOutsideJob: spawn, readCreationTimeMs: () => creationTimeMs }
}

const argv = [
  'C:\\rt\\node.exe',
  'C:\\Users\\me user\\.topo-remote\\relay-1\\relay.js',
  RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  '--stdout-file',
  'C:/Users/me user/relay.log',
  '--stderr-file',
  'C:/Users/me user/relay.err.log',
  '--relay-args',
  '--detached',
  '--sock-path',
  '\\\\.\\pipe\\topo-relay-1',
  '--log-file',
  'C:/Users/me user/relay.log'
]

describe('relay Windows breakaway launcher', () => {
  it('takes its own flags before -- and hands the rest to the relay', () => {
    expect(parseRelayWindowsBreakawayLaunch(argv)).toEqual({
      stdoutPath: 'C:/Users/me user/relay.log',
      stderrPath: 'C:/Users/me user/relay.err.log',
      env: {},
      programArgs: argv.slice(8)
    })
  })
})

describe('topod Windows breakaway launcher', () => {
  const topodArgv = [
    'C:\\rt\\node.exe',
    'C:\\Users\\me\\.topo-remote\\topod-1\\topod.js',
    RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    '--stdout-file',
    'C:/slot/.topod-readiness',
    '--stderr-file',
    'C:/slot/topod.log',
    '--process-file',
    'C:/slot/.topod-process.json',
    '--topod-args',
    '--json',
    '--bind',
    '127.0.0.1'
  ]
  const topodRuntime = { execPath: topodArgv[0], script: topodArgv[1], cwd: 'C:/slot' }

  it('splits on its own args flag, not the relay one', () => {
    expect(parseWindowsBreakawayLaunchRequest(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, topodArgv)).toEqual(
      {
        stdoutPath: 'C:/slot/.topod-readiness',
        stderrPath: 'C:/slot/topod.log',
        processFilePath: 'C:/slot/.topod-process.json',
        env: {},
        programArgs: ['--json', '--bind', '127.0.0.1']
      }
    )
  })

  it('collects --env assignments for the launched process and refuses a malformed one', () => {
    const withEnv = [
      ...topodArgv.slice(0, 3),
      '--env',
      'TOPO_VERSION=0.2.0+bb01',
      '--env',
      'TOPO_USER_DATA=C:/Users/Ann Lee/.topo',
      ...topodArgv.slice(3)
    ]
    expect(
      parseWindowsBreakawayLaunchRequest(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, withEnv)?.env
    ).toEqual({ TOPO_VERSION: '0.2.0+bb01', TOPO_USER_DATA: 'C:/Users/Ann Lee/.topo' })
    expect(() =>
      parseWindowsBreakawayLaunchRequest(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, [
        ...topodArgv.slice(0, 3),
        '--env',
        'lower=1',
        ...topodArgv.slice(3)
      ])
    ).toThrow('NAME=VALUE')
  })

  it('fails the launch and stops the process when its record cannot be written', () => {
    const request = parseWindowsBreakawayLaunchRequest(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, topodArgv)
    if (!request) {
      throw new Error('expected a launch request')
    }
    const terminated: number[] = []
    const outcome = launchOutsideJob(
      request,
      launcherFor(() => ({ ok: true, pid: 4242, inJob: false })),
      topodRuntime,
      () => {
        throw Object.assign(new Error('EACCES'), { errno: -4048 })
      },
      (pid) => terminated.push(pid)
    )
    expect(outcome).toEqual({
      report: { method: 'failed', reason: 'process-file', code: -4048 },
      exitCode: RELAY_WINDOWS_BREAKAWAY_EXIT_CODES.failed
    })
    expect(terminated).toEqual([4242])
  })

  it('reports under its own marker, which the relay parser does not read', () => {
    const line = 'TOPO_TOPOD_LAUNCH {"method":"breakaway","pid":9,"inJob":false}'
    expect(parseWindowsBreakawayLaunchReport(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, line)).toEqual({
      method: 'breakaway',
      pid: 9,
      inJob: false
    })
    expect(parseWindowsBreakawayLaunchReport(RELAY_WINDOWS_BREAKAWAY_CONTRACT, line)).toBeNull()
  })
})
