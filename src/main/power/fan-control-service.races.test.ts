import { describe, expect, it, vi } from 'vitest'
import type { FanCurve } from '../../shared/fan-control-contract'
import {
  CHIP_CURVE,
  LEASE,
  MAX_RPM,
  PROFILE,
  TWO_FAN_READINGS,
  TWO_FANS,
  createHarness,
  expectSupported,
  leaseTargets,
  sensorsOutput,
  settle,
  storedProfile,
  type RunPrivileged
} from './fan-control-service.test-support'

function statusReads(runHelper: { mock: { calls: string[][][] } }): number {
  return runHelper.mock.calls.filter(([args]) => args[0] === 'status').length
}

function helperRuns(runHelper: { mock: { calls: unknown[] } }): number {
  return runHelper.mock.calls.length
}

describe('FanControlService hold-exited detection', () => {
  it('does not report hold-exited while the helper still reads auto right after targets switch on', async () => {
    const harness = createHarness()
    // The root loop needs 200-400 ms to see the lease and up to ~1 s for FxMd to land.
    harness.runHelper.mockImplementation(async (args) => ({
      code: 0,
      stdout: args[0] === 'sensors' ? sensorsOutput(harness.sensors) : TWO_FANS,
      stderr: ''
    }))
    await harness.service.setMode('max')
    harness.clock.now += 500

    const status = expectSupported(await harness.service.tick())

    expect(status.mode).toBe('max')
    expect(status.session).toBe('active')
    expect(status.lastError).toBeUndefined()
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])
  })

  it('does not report hold-exited on the first tick after wake re-applies fixed targets', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    await harness.service.handleSuspend()
    harness.clock.now += 60_000
    harness.runHelper.mockResolvedValue({ code: 0, stdout: TWO_FANS, stderr: '' })

    await harness.service.handleResume()
    harness.clock.now += 200
    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('max')
    expect(status.lastError).toBeUndefined()
  })

  it('needs a second auto reading after the grace period before declaring the hold gone', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    harness.runHelper.mockResolvedValue({ code: 0, stdout: TWO_FANS, stderr: '' })
    harness.clock.now += 3_000

    expect(expectSupported(await harness.service.refresh()).lastError).toBeUndefined()
    harness.clock.now += 2_000
    const status = expectSupported(await harness.service.refresh())

    expect(status.lastError?.kind).toBe('hold-exited')
    expect(status.session).toBe('none')
  })
})

describe('FanControlService after release for quit', () => {
  it('neither prompts nor reports success once released', async () => {
    const harness = createHarness()
    await harness.service.getStatus()
    harness.service.releaseForQuit()

    const result = await harness.service.setMode('max')

    expect(result.ok).toBe(false)
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('removes the lease and fails when release lands while the password prompt is open', async () => {
    const harness = createHarness()
    harness.runPrivileged.mockImplementation(async () => {
      harness.service.releaseForQuit()
      harness.files.set(LEASE, 'ready')
    })

    const result = await harness.service.setMode('max')

    expect(result.ok).toBe(false)
    expect(expectSupported(result.status).session).toBe('none')
    expect(harness.files.has(LEASE)).toBe(false)
  })
})

describe('FanControlService setCurve', () => {
  const warmer: FanCurve = {
    source: 'chip',
    points: [
      { tempC: 30, percent: 0 },
      { tempC: 90, percent: 100 }
    ]
  }

  it('recomputes targets from the latest reading without running the helper', async () => {
    const harness = createHarness({ sensors: { chipC: 60 } })
    await harness.service.setCurve(CHIP_CURVE)
    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])
    const before = helperRuns(harness.runHelper)

    const result = await harness.service.setCurve(warmer)

    expect(helperRuns(harness.runHelper)).toBe(before)
    const targets = leaseTargets(harness.files)
    expect(targets.every((rpm) => rpm !== null && rpm < MAX_RPM)).toBe(true)
    expect(expectSupported(result.status).appliedRpm).toEqual(targets)
  })

  it('coalesces a burst of curve saves into fewer profile writes that end on the last curve', async () => {
    const harness = createHarness()
    await harness.service.getStatus()
    const writeFile = vi.spyOn(harness.deps.fs, 'writeFile')
    const curves = Array.from({ length: 6 }, (_, i) => ({
      source: 'chip' as const,
      points: [
        { tempC: 40 + i, percent: 0 },
        { tempC: 80, percent: 100 }
      ]
    }))

    await Promise.all(curves.map((curve) => harness.service.setCurve(curve)))

    const profileWrites = writeFile.mock.calls.filter(([path]) => path === `${PROFILE}.tmp`)
    expect(profileWrites.length).toBeLessThan(curves.length)
    expect(storedProfile(harness.files)).toMatchObject({ curve: curves.at(-1) })
  })
})

describe('FanControlService superseded password prompt', () => {
  it('returns ok without auth-cancelled when a newer request replaced the cancelled one', async () => {
    const cancelled = Object.assign(new Error('execution error: User canceled. (-128)'), {
      code: 1,
      stderr: 'execution error: User canceled. (-128)'
    })
    let cancel: (() => void) | null = null
    const harness = createHarness({
      runPrivileged: () =>
        vi.fn<RunPrivileged>(
          () =>
            new Promise<void>((_, reject) => {
              cancel = () => reject(cancelled)
            })
        )
    })
    const max = harness.service.setMode('max')
    await settle()
    expect(cancel).not.toBeNull()
    await harness.service.setMode('auto')

    cancel!()
    const result = await max

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('auto')
    expect(status.lastError).toBeUndefined()
    expect(expectSupported(await harness.service.getStatus()).lastError).toBeUndefined()
  })
})

describe('FanControlService getStatus freshness', () => {
  it('re-reads the fans once when the cached reading is older than 5 s, without polling', async () => {
    const fans = TWO_FAN_READINGS.map((fan) => ({ ...fan }))
    const harness = createHarness({ fans })
    await harness.service.getStatus()
    expect(statusReads(harness.runHelper)).toBe(1)

    harness.clock.now += 2_000
    await harness.service.getStatus()
    expect(statusReads(harness.runHelper)).toBe(1)

    fans[0].rpm = 3100
    harness.clock.now += 4_000
    const [first, second] = await Promise.all([
      harness.service.getStatus(),
      harness.service.getStatus()
    ])

    expect(statusReads(harness.runHelper)).toBe(2)
    expect(expectSupported(first).fans[0].rpm).toBe(3100)
    expect(expectSupported(second).fans[0].rpm).toBe(3100)
    expect(harness.timers.active.size).toBe(0)
  })
})
