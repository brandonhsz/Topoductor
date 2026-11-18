import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FAN_CONTROL_HELPER_BINARY,
  FAN_CONTROL_HELPER_COMMANDS,
  FAN_CONTROL_HELPER_EXIT_CODES,
  FAN_CONTROL_SESSION_ARGS,
  FAN_CONTROL_SESSION_READY_LINE
} from '../../shared/fan-control-contract'
import {
  parseFanControlStatusOutput,
  parseFanSensorsOutput,
  serializeFanTargets
} from './fan-control-helper-protocol'

const HELPER = resolve(
  __dirname,
  '../../../native/fan-control-macos/.build/release',
  FAN_CONTROL_HELPER_BINARY
)
const canRun = process.platform === 'darwin' && existsSync(HELPER)

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

function tempLease(): string {
  const dir = mkdtempSync(join(tmpdir(), 'topo-fan-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const lease = join(dir, 'fan-control.lease')
  writeFileSync(lease, 'pending')
  return lease
}

function spawnParent(): ChildProcess {
  const parent = spawn('sleep', ['30'], { stdio: 'ignore' })
  cleanups.push(() => parent.kill('SIGKILL'))
  return parent
}

type ControlSession = { child: ChildProcess; stdoutLines: () => string[] }

// --dry-run never touches the SMC and echoes each new valid targets line it reads to stdout.
function spawnControl(parentPid: number, lease: string): ControlSession {
  const child = spawn(
    HELPER,
    [
      FAN_CONTROL_HELPER_COMMANDS.control,
      FAN_CONTROL_SESSION_ARGS.parentPid,
      String(parentPid),
      FAN_CONTROL_SESSION_ARGS.lease,
      lease,
      FAN_CONTROL_SESSION_ARGS.dryRun
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  cleanups.push(() => child.kill('SIGKILL'))
  let stdout = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  return {
    child,
    stdoutLines: () =>
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
  }
}

async function readySession(): Promise<ControlSession & { lease: string; parent: ChildProcess }> {
  const lease = tempLease()
  const parent = spawnParent()
  const session = spawnControl(parent.pid!, lease)
  await vi.waitFor(() => leaseIsReady(lease), { timeout: 2000 })
  return { ...session, lease, parent }
}

function leaseIsReady(lease: string): void {
  expect(readFileSync(lease, 'utf8').trim()).toBe(FAN_CONTROL_SESSION_READY_LINE)
}

// Main rewrites the lease in place: a rename would change the inode and end the session.
function writeTargets(lease: string, line: string): void {
  writeFileSync(lease, `${line}\n`)
}

function echoedTargets(session: ControlSession): unknown[] {
  return session.stdoutLines().map((line) => JSON.parse(line))
}

async function waitForEcho(session: ControlSession, targets: (number | null)[]): Promise<void> {
  await vi.waitFor(() => expect(echoedTargets(session)).toContainEqual({ v: 1, targets }), {
    timeout: 2000
  })
}

async function expectExit(child: ChildProcess): Promise<number | null> {
  await vi.waitFor(() => expect(child.exitCode ?? child.signalCode).not.toBeNull(), {
    timeout: 2000
  })
  return child.exitCode
}

function runSync(args: string[]): number | null {
  return spawnSync(HELPER, args, { stdio: 'ignore', timeout: 5000 }).status
}

// Skipped off macOS or before native/fan-control-macos is built (pnpm build:fan-control-macos).
describe.skipIf(!canRun)('topo-fan-control helper (no root)', () => {
  it('status prints one JSON line with fans and mode', () => {
    const result = spawnSync(HELPER, ['status'], { encoding: 'utf8', timeout: 5000 })
    expect(result.status).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
    const parsed = parseFanControlStatusOutput(result.stdout)
    if (!parsed) {
      throw new Error(`status printed invalid JSON: ${result.stdout}`)
    }
    expect(['auto', 'manual']).toContain(parsed.mode)
    for (const fan of parsed.fans) {
      expect(fan).toEqual({
        index: expect.any(Number),
        rpm: expect.any(Number),
        minRpm: expect.any(Number),
        maxRpm: expect.any(Number)
      })
    }
  })

  it('sensors prints one JSON line with chip, palm-rest and battery readings', () => {
    const result = spawnSync(HELPER, [FAN_CONTROL_HELPER_COMMANDS.sensors], {
      encoding: 'utf8',
      timeout: 5000
    })
    expect(result.status).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    const parsed = parseFanSensorsOutput(result.stdout)
    if (!parsed) {
      throw new Error(`sensors printed invalid JSON: ${result.stdout}`)
    }
    for (const reading of [...parsed.chip, ...parsed.palmrest, ...parsed.battery]) {
      expect(reading).toEqual({ key: expect.stringMatching(/^T/), c: expect.any(Number) })
    }
  })

  it('control --dry-run marks the lease ready and exits within 2s once the lease is removed', async () => {
    const session = await readySession()
    rmSync(session.lease)
    expect(await expectExit(session.child)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
  })

  it('control --dry-run reads each new targets line from the lease', async () => {
    const session = await readySession()

    writeTargets(session.lease, serializeFanTargets([3500, null]))
    await waitForEcho(session, [3500, null])

    writeTargets(session.lease, serializeFanTargets([null, 6800]))
    await waitForEcho(session, [null, 6800])
    expect(session.child.exitCode).toBeNull()
  })

  // The root session outlives "auto": only the lease or the parent ends it, so no new password.
  it('control --dry-run keeps reading after targets hand every fan to macOS', async () => {
    const session = await readySession()

    writeTargets(session.lease, serializeFanTargets([null, null]))
    await waitForEcho(session, [null, null])
    writeTargets(session.lease, serializeFanTargets([2317, 2317]))
    await waitForEcho(session, [2317, 2317])
  })

  it('control --dry-run exits within 2s once the parent process dies', async () => {
    const session = await readySession()
    session.parent.kill('SIGKILL')
    expect(await expectExit(session.child)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
  })

  it('control --dry-run exits on SIGTERM', async () => {
    const session = await readySession()
    session.child.kill('SIGTERM')
    await expectExit(session.child)
  })

  it.each([
    [
      'a relative lease path',
      ['control', '--parent-pid', '1', '--lease', 'fan.lease', '--dry-run']
    ],
    [
      'a non-numeric pid',
      ['control', '--parent-pid', 'abc', '--lease', '/tmp/x.lease', '--dry-run']
    ],
    ['a missing lease', ['control', '--parent-pid', '1', '--dry-run']],
    ['an unknown command', ['format-disk']],
    [
      'an unknown flag',
      ['control', '--parent-pid', '1', '--lease', '/tmp/x.lease', '--exec', 'sh']
    ],
    ['extra sensors arguments', ['sensors', '--all']]
  ])('rejects %s with exit code 2', (_label, args) => {
    expect(runSync(args)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.invalidArgs)
  })

  it('rejects the removed legacy hold even with a valid lease', () => {
    const lease = tempLease()
    const parent = spawnParent()
    const result = spawnSync(
      HELPER,
      ['hold', '--parent-pid', String(parent.pid), '--lease', lease, '--dry-run'],
      { stdio: 'ignore', timeout: 1500 }
    )
    expect(result.status).toBe(FAN_CONTROL_HELPER_EXIT_CODES.invalidArgs)
  })

  it('refuses a lease that is a symlink, since the real control session writes it as root', () => {
    const lease = tempLease()
    const link = `${lease}.link`
    symlinkSync(lease, link)
    expect(
      runSync(['control', '--parent-pid', String(process.pid), '--lease', link, '--dry-run'])
    ).toBe(FAN_CONTROL_HELPER_EXIT_CODES.invalidArgs)
  })
})

describe('topo-fan-control helper availability', () => {
  it.runIf(process.platform === 'darwin' && process.env.TOPO_REQUIRE_FAN_HELPER === '1')(
    'is built when the native build is required',
    () => {
      expect(existsSync(HELPER)).toBe(true)
    }
  )
})
