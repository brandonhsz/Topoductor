import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FAN_CONTROL_HELPER_BINARY,
  FAN_CONTROL_HELPER_EXIT_CODES,
  FAN_CONTROL_HOLD_READY_LINE,
  type FanControlHelperStatusOutput
} from '../../shared/fan-control-contract'

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

function spawnHold(parentPid: number, lease: string): ChildProcess {
  const hold = spawn(
    HELPER,
    ['hold', '--parent-pid', String(parentPid), '--lease', lease, '--dry-run'],
    { stdio: 'ignore' }
  )
  cleanups.push(() => hold.kill('SIGKILL'))
  return hold
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return true
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  return check()
}

function exitWithin(child: ChildProcess, timeoutMs: number): Promise<number | null | 'timeout'> {
  return new Promise((done) => {
    if (child.exitCode !== null) {
      done(child.exitCode)
      return
    }
    const timer = setTimeout(() => done('timeout'), timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      done(code)
    })
  })
}

function runSync(args: string[]): number | null {
  return spawnSync(HELPER, args, { stdio: 'ignore', timeout: 5000 }).status
}

// Skipped off macOS or before native/fan-control-macos is built (pnpm build:fan-control-macos).
describe.skipIf(!canRun)('topo-fan-control helper (no root)', () => {
  it('status prints one JSON line with fans and mode', () => {
    const result = spawnSync(HELPER, ['status'], { encoding: 'utf8', timeout: 5000 })
    expect(result.status).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
    const parsed = JSON.parse(result.stdout.trim()) as FanControlHelperStatusOutput
    expect(Array.isArray(parsed.fans)).toBe(true)
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

  it('hold --dry-run marks the lease ready and exits within 2s once the lease is removed', async () => {
    const lease = tempLease()
    const parent = spawnParent()
    const hold = spawnHold(parent.pid!, lease)

    expect(
      await waitFor(() => readFileSync(lease, 'utf8').trim() === FAN_CONTROL_HOLD_READY_LINE, 2000)
    ).toBe(true)
    rmSync(lease)
    expect(await exitWithin(hold, 2000)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
  })

  it('hold --dry-run exits within 2s once the parent process dies', async () => {
    const lease = tempLease()
    const parent = spawnParent()
    const hold = spawnHold(parent.pid!, lease)

    await waitFor(() => readFileSync(lease, 'utf8').trim() === FAN_CONTROL_HOLD_READY_LINE, 2000)
    parent.kill('SIGKILL')
    expect(await exitWithin(hold, 2000)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.ok)
  })

  it('hold --dry-run exits on SIGTERM', async () => {
    const lease = tempLease()
    const parent = spawnParent()
    const hold = spawnHold(parent.pid!, lease)

    await waitFor(() => readFileSync(lease, 'utf8').trim() === FAN_CONTROL_HOLD_READY_LINE, 2000)
    hold.kill('SIGTERM')
    expect(await exitWithin(hold, 2000)).not.toBe('timeout')
  })

  it.each([
    ['a relative lease path', ['hold', '--parent-pid', '1', '--lease', 'fan.lease', '--dry-run']],
    ['a non-numeric pid', ['hold', '--parent-pid', 'abc', '--lease', '/tmp/x.lease', '--dry-run']],
    ['a missing lease', ['hold', '--parent-pid', '1', '--dry-run']],
    ['an unknown command', ['format-disk']],
    ['an unknown flag', ['hold', '--parent-pid', '1', '--lease', '/tmp/x.lease', '--exec', 'sh']]
  ])('rejects %s with exit code 2', (_label, args) => {
    expect(runSync(args)).toBe(FAN_CONTROL_HELPER_EXIT_CODES.invalidArgs)
  })

  it('refuses a lease that is a symlink, since the real hold writes it as root', () => {
    const lease = tempLease()
    const link = `${lease}.link`
    symlinkSync(lease, link)
    expect(
      runSync(['hold', '--parent-pid', String(process.pid), '--lease', link, '--dry-run'])
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
