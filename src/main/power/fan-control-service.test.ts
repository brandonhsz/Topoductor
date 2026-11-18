import { describe, expect, it, vi, type Mock } from 'vitest'
import type {
  FanControlGlobalSettings,
  FanControlStatus,
  FanControlTargets,
  FanCurve,
  FanCurvePoint
} from '../../shared/fan-control-contract'
import { FanControlService, type FanControlServiceDeps } from './fan-control-service'

const HELPER = '/Applications/Topo.app/Contents/MacOS/topo-fan-control'
const LEASE = '/Users/me/Library/Application Support/topo/fan-control.lease'
const PROFILE = '/Users/me/Library/Application Support/topo/fan-control-profile.json'
const MIN_RPM = 2317
const MAX_RPM = 6800
const TICK_MS = 2_000
const MINUTE = 60_000
const START = Date.UTC(2026, 10, 17, 15, 0, 0)

const TWO_FAN_READINGS = [
  { index: 0, rpm: 2300, minRpm: MIN_RPM, maxRpm: MAX_RPM },
  { index: 1, rpm: 2500, minRpm: MIN_RPM, maxRpm: MAX_RPM }
]
const TWO_FANS = JSON.stringify({ mode: 'auto', fans: TWO_FAN_READINGS })

// Drawn against the raw chip line so expected targets do not depend on the blend weights.
// Pure modules are imported per test so the still-valid service tests load before they exist.
async function initialSmartPoints(): Promise<FanCurvePoint[]> {
  const { INITIAL_SMART_CURVE } = await import('./smart-fan-profile')
  return curvePoints(INITIAL_SMART_CURVE)
}

const STORED_SMART_POINTS: FanCurvePoint[] = [
  { tempC: 55, percent: 0 },
  { tempC: 85, percent: 100 }
]

const CHIP_CURVE: FanCurve = {
  source: 'chip',
  points: [
    { tempC: 40, percent: 0 },
    { tempC: 60, percent: 100 }
  ]
}

type RunHelper = FanControlServiceDeps['runHelper']
type RunPrivileged = FanControlServiceDeps['runPrivileged']
type SupportedStatus = Extract<FanControlStatus, { supported: true }>
type Sensors = { chipC: number; palmrestC: number | null }

type FakeTimers = {
  setInterval: Mock<(callback: () => void, ms: number) => unknown>
  clearInterval: Mock<(handle: unknown) => void>
  active: Map<unknown, number>
}

type Harness = {
  service: FanControlService
  deps: FanControlServiceDeps
  files: Map<string, string>
  runPrivileged: Mock<RunPrivileged>
  runHelper: Mock<RunHelper>
  updateSettings: Mock<FanControlServiceDeps['updateSettings']>
  settings: FanControlGlobalSettings
  timers: FakeTimers
  clock: { now: number }
  sensors: Sensors
}

type HarnessOverrides = Partial<
  Omit<FanControlServiceDeps, 'runHelper' | 'runPrivileged' | 'updateSettings'>
> & {
  runHelper?: Mock<RunHelper>
  runPrivileged?: (files: Map<string, string>) => Mock<RunPrivileged>
  initialFiles?: Record<string, string>
  fanSmartFeedbackPrompts?: boolean
  sensors?: Partial<Sensors>
}

function sensorsOutput({ chipC, palmrestC }: Sensors): string {
  return JSON.stringify({
    chip: [
      { key: 'Tp01', c: chipC - 4 },
      { key: 'Tp05', c: chipC }
    ],
    palmrest:
      palmrestC === null
        ? []
        : [
            { key: 'Ts0P', c: palmrestC },
            { key: 'Ts1P', c: palmrestC }
          ],
    battery: [{ key: 'TB0T', c: 35 }]
  })
}

function parseLease(raw: string | undefined): FanControlTargets | null {
  if (raw === undefined) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw.trim())
    return typeof parsed === 'object' && parsed !== null && 'targets' in parsed
      ? (parsed as FanControlTargets)
      : null
  } catch {
    return null
  }
}

function createTimers(): FakeTimers {
  const active = new Map<unknown, number>()
  let nextHandle = 1
  return {
    active,
    setInterval: vi.fn((_callback: () => void, ms: number) => {
      const handle = nextHandle++
      active.set(handle, ms)
      return handle
    }),
    clearInterval: vi.fn((handle: unknown) => {
      active.delete(handle)
    })
  }
}

function createHarness(overrides: HarnessOverrides = {}): Harness {
  const {
    runHelper: helperOverride,
    runPrivileged: privilegedOverride,
    initialFiles,
    fanSmartFeedbackPrompts = true,
    sensors: sensorOverrides,
    ...rest
  } = overrides
  const files = new Map<string, string>(Object.entries(initialFiles ?? {}))
  const sensors: Sensors = { chipC: 50, palmrestC: null, ...sensorOverrides }
  const settings: FanControlGlobalSettings = { fanSmartFeedbackPrompts }
  const clock = { now: START }
  const timers = createTimers()
  // Mirrors the root helper: fans read as `manual` while any lease target is a fixed RPM.
  const runHelper =
    helperOverride ??
    vi.fn<RunHelper>(async (args) => {
      if (args[0] === 'sensors') {
        return { code: 0, stdout: sensorsOutput(sensors), stderr: '' }
      }
      const forced = parseLease(files.get(LEASE))?.targets.some((target) => target !== null)
      return {
        code: 0,
        stdout: JSON.stringify({ mode: forced ? 'manual' : 'auto', fans: TWO_FAN_READINGS }),
        stderr: ''
      }
    })
  // The real control session rewrites the lease to 'ready' once it owns the fans.
  const runPrivileged =
    privilegedOverride?.(files) ??
    vi.fn<RunPrivileged>(async () => {
      files.set(LEASE, 'ready')
    })
  const updateSettings = vi.fn<FanControlServiceDeps['updateSettings']>((patch) => {
    Object.assign(settings, patch)
  })
  const deps: FanControlServiceDeps = {
    platform: 'darwin',
    helperPath: HELPER,
    leasePath: LEASE,
    profilePath: PROFILE,
    pid: 4242,
    runHelper,
    runPrivileged,
    getSettings: () => ({ ...settings }),
    updateSettings,
    now: () => clock.now,
    timers: { setInterval: timers.setInterval, clearInterval: timers.clearInterval },
    fs: {
      writeFile: async (path, data) => {
        files.set(path, data)
      },
      readFile: async (path) => files.get(path) ?? null,
      rename: async (from, to) => {
        const data = files.get(from)
        if (data === undefined) {
          throw new Error(`ENOENT: ${from}`)
        }
        files.set(to, data)
        files.delete(from)
      },
      rm: async (path) => {
        files.delete(path)
      },
      rmSync: (path) => {
        files.delete(path)
      }
    },
    sleep: async () => {},
    readyTimeoutMs: 50,
    ...rest
  }
  return {
    service: new FanControlService(deps),
    deps,
    files,
    runPrivileged,
    runHelper,
    updateSettings,
    settings,
    timers,
    clock,
    sensors
  }
}

function expectSupported(status: FanControlStatus): SupportedStatus {
  if (!status.supported) {
    throw new Error(`expected a supported status, got ${status.reason}`)
  }
  return status
}

function leaseTargets(files: Map<string, string>): (number | null)[] {
  const lease = parseLease(files.get(LEASE))
  if (!lease) {
    throw new Error(`expected a targets line in the lease, got ${files.get(LEASE)}`)
  }
  expect(lease.v).toBe(1)
  return lease.targets
}

function storedProfile(files: Map<string, string>): Record<string, unknown> {
  const raw = files.get(PROFILE)
  if (raw === undefined) {
    throw new Error('expected the profile to be persisted')
  }
  return JSON.parse(raw) as Record<string, unknown>
}

function profileFile(profile: {
  lastMode: string
  curve?: FanCurve
  manualRpm?: Record<number, number>
}): Record<string, string> {
  return {
    [PROFILE]: JSON.stringify({
      curve: profile.curve ?? CHIP_CURVE,
      smart: { learned: STORED_SMART_POINTS, answers: 2, updatedAt: START - MINUTE },
      manualRpm: profile.manualRpm ?? {},
      lastMode: profile.lastMode
    })
  }
}

// Tolerates INITIAL_SMART_CURVE shipped as a FanCurve or as its bare points.
function curvePoints(curve: FanCurve | readonly FanCurvePoint[]): FanCurvePoint[] {
  return Array.isArray(curve) ? [...curve] : [...(curve as FanCurve).points]
}

async function startSmartPrompt(harness: Harness): Promise<SupportedStatus> {
  harness.sensors.chipC = 65
  await harness.service.setMode('smart')
  const status = expectSupported(await harness.service.tick())
  expect(status.feedbackPrompt).not.toBeNull()
  return status
}

describe('FanControlService support detection', () => {
  it.each(['linux', 'win32'] as const)(
    'reports not-macos on %s without running the helper',
    async (platform) => {
      const { service, runHelper } = createHarness({ platform })
      expect(await service.getStatus()).toEqual({ supported: false, reason: 'not-macos' })
      expect(runHelper).not.toHaveBeenCalled()
    }
  )

  it('reports helper-missing when the bundled helper is absent', async () => {
    const { service } = createHarness({ helperPath: null })
    expect(await service.getStatus()).toEqual({ supported: false, reason: 'helper-missing' })
  })

  it('reports smc-unavailable when the status helper fails', async () => {
    const { service } = createHarness({
      runHelper: vi.fn<RunHelper>(async () => ({
        code: 1,
        stdout: '{"error":"cannot open AppleSMC"}',
        stderr: ''
      }))
    })
    expect(await service.getStatus()).toEqual({ supported: false, reason: 'smc-unavailable' })
  })

  it('returns auto mode with per-fan readings on a supported Mac', async () => {
    const { service, runHelper } = createHarness()
    const status = expectSupported(await service.getStatus())
    expect(status.mode).toBe('auto')
    expect(status.pending).toBe(false)
    expect(status.controllable).toBe(true)
    expect(status.session).toBe('none')
    expect(status.fans).toEqual(TWO_FAN_READINGS)
    expect(runHelper).toHaveBeenCalledWith(['status'])
  })

  it('keeps fanless Macs supported but not controllable, showing temperatures only', async () => {
    const harness = createHarness({ sensors: { chipC: 70 } })
    harness.runHelper.mockImplementation(async (args) => ({
      code: 0,
      stdout:
        args[0] === 'sensors'
          ? sensorsOutput(harness.sensors)
          : JSON.stringify({ mode: 'auto', fans: [] }),
      stderr: ''
    }))

    harness.service.setMonitoring(true)
    const status = expectSupported(await harness.service.tick())

    expect(status.controllable).toBe(false)
    expect(status.fans).toEqual([])
    expect(status.thermal.chipC).toBe(70)
    expect(status.thermal.palmrestAvailable).toBe(false)
  })

  it('refuses a non-auto mode on a fanless Mac without asking for the password', async () => {
    const harness = createHarness()
    harness.runHelper.mockImplementation(async (args) => ({
      code: 0,
      stdout:
        args[0] === 'sensors'
          ? sensorsOutput(harness.sensors)
          : JSON.stringify({ mode: 'auto', fans: [] }),
      stderr: ''
    }))

    const result = await harness.service.setMode('curve')

    expect(result).toMatchObject({ ok: false, error: { kind: 'not-controllable' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })
})

describe('FanControlService control session', () => {
  it('opens one detached root control session with shell-quoted args and writes max targets once ready', async () => {
    const { service, runPrivileged, files } = createHarness()
    const result = await service.setMode('max')

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('max')
    expect(status.session).toBe('active')
    expect(status.appliedRpm).toEqual([MAX_RPM, MAX_RPM])
    expect(leaseTargets(files)).toEqual([MAX_RPM, MAX_RPM])
    expect(runPrivileged).toHaveBeenCalledTimes(1)
    const [command] = runPrivileged.mock.calls[0]
    expect(command).toContain(`'${HELPER}' control`)
    expect(command).not.toContain(' hold ')
    expect(command).toContain('--parent-pid 4242')
    expect(command).toContain(`--lease '${LEASE}'`)
    // Detached so osascript returns while the root session keeps running.
    expect(command.trimEnd().endsWith('&')).toBe(true)
  })

  it('escapes single quotes in paths before handing them to the root shell', async () => {
    const lease = "/Users/o'brien/Library/Application Support/topo/fan-control.lease"
    const { service, runPrivileged } = createHarness({
      leasePath: lease,
      runPrivileged: (files) =>
        vi.fn<RunPrivileged>(async () => {
          files.set(lease, 'ready')
        })
    })
    await service.setMode('max')
    const [command] = runPrivileged.mock.calls[0]
    expect(command).toContain(
      `--lease '/Users/o'\\''brien/Library/Application Support/topo/fan-control.lease'`
    )
  })

  it('asks for the password once per Topo session across curve, smart, manual, max and auto', async () => {
    const { service, runPrivileged } = createHarness({ sensors: { chipC: 60 } })
    await service.setCurve(CHIP_CURVE)

    for (const mode of ['curve', 'smart', 'manual', 'max', 'auto', 'curve'] as const) {
      const result = await service.setMode(mode)
      expect(result.ok).toBe(true)
      expect(expectSupported(result.status).mode).toBe(mode)
    }
    await service.setManualRpm(0, 3000)

    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('shares one password prompt between concurrent mode requests', async () => {
    const { service, runPrivileged } = createHarness()
    await Promise.all([service.setMode('curve'), service.setMode('smart')])
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('keeps the root session alive with null targets when returning to auto', async () => {
    const { service, files, runPrivileged } = createHarness()
    await service.setMode('max')
    const listener = vi.fn()
    service.subscribe(listener)

    const result = await service.setMode('auto')

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('auto')
    expect(status.session).toBe('active')
    expect(status.appliedRpm).toEqual([null, null])
    expect(leaseTargets(files)).toEqual([null, null])
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ supported: true, mode: 'auto' })
    )

    await service.setMode('max')
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('stays in auto, clears the lease and reports auth-cancelled when the password prompt is cancelled', async () => {
    const cancelled = Object.assign(new Error('execution error: User canceled. (-128)'), {
      code: 1,
      stderr: 'execution error: User canceled. (-128)'
    })
    const { service, files, runPrivileged } = createHarness({
      runPrivileged: () =>
        vi.fn<RunPrivileged>(async () => {
          throw cancelled
        })
    })
    const result = await service.setMode('curve')

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth-cancelled' } })
    const status = expectSupported(result.status)
    expect(status.mode).toBe('auto')
    expect(status.session).toBe('none')
    expect(status.lastError).toEqual({ kind: 'auth-cancelled' })
    expect(files.has(LEASE)).toBe(false)

    // No session was opened, so the next attempt has to ask again.
    await service.setMode('curve')
    expect(runPrivileged).toHaveBeenCalledTimes(2)
  })

  it('hides the control with write-rejected when the session reports the SMC refused the write', async () => {
    const harness = createHarness()
    harness.runPrivileged.mockImplementation(async () => {
      harness.files.set(LEASE, 'write-rejected')
    })
    const result = await harness.service.setMode('max')

    expect(result.ok).toBe(false)
    expect(result.status).toEqual({ supported: false, reason: 'write-rejected' })
    expect(await harness.service.getStatus()).toEqual({
      supported: false,
      reason: 'write-rejected'
    })
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('reports helper-failed and stays in auto when the session never signals ready', async () => {
    const { service, files } = createHarness({
      runPrivileged: () => vi.fn<RunPrivileged>(async () => {})
    })
    const result = await service.setMode('max')

    expect(result).toMatchObject({ ok: false, error: { kind: 'helper-failed' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(files.has(LEASE)).toBe(false)
  })

  it('is idempotent: max while already max does not prompt again', async () => {
    const { service, runPrivileged } = createHarness()
    await service.setMode('max')
    await service.setMode('max')
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers that a request is pending while the password prompt is open', async () => {
    const { service } = createHarness()
    const seen: FanControlStatus[] = []
    service.subscribe((status) => seen.push(status))
    await service.setMode('max')
    expect(seen.some((status) => status.supported && status.pending)).toBe(true)
    expect(
      seen.some((status) => status.supported && status.pending && status.session === 'pending')
    ).toBe(true)
    expect(seen.at(-1)).toMatchObject({
      supported: true,
      mode: 'max',
      pending: false,
      session: 'active'
    })
  })
})

describe('FanControlService curve and manual modes', () => {
  it('writes curve targets from the chosen temperature line and hands fans back to macOS below the threshold', async () => {
    const harness = createHarness({ sensors: { chipC: 60, palmrestC: 30 } })
    await harness.service.setCurve(CHIP_CURVE)
    const result = await harness.service.setMode('curve')

    expect(expectSupported(result.status).appliedRpm).toEqual([MAX_RPM, MAX_RPM])
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    harness.sensors.chipC = 40
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([MIN_RPM, MIN_RPM])
    expect(leaseTargets(harness.files)).toEqual([MIN_RPM, MIN_RPM])

    harness.sensors.chipC = 30
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([null, null])
    expect(leaseTargets(harness.files)).toEqual([null, null])
  })

  it('saves a valid curve without switching mode or prompting, and rejects an invalid one', async () => {
    const harness = createHarness()
    const saved = await harness.service.setCurve(CHIP_CURVE)

    expect(saved.ok).toBe(true)
    const status = expectSupported(saved.status)
    expect(status.mode).toBe('auto')
    expect(status.curve).toEqual(CHIP_CURVE)
    expect(storedProfile(harness.files)).toMatchObject({ curve: CHIP_CURVE })
    expect(harness.runPrivileged).not.toHaveBeenCalled()

    const descending: FanCurve = {
      source: 'chip',
      points: [
        { tempC: 70, percent: 10 },
        { tempC: 50, percent: 90 }
      ]
    }
    const rejected = await harness.service.setCurve(descending)

    expect(rejected).toMatchObject({ ok: false, error: { kind: 'invalid-curve' } })
    expect(expectSupported(rejected.status).curve).toEqual(CHIP_CURVE)
    expect(storedProfile(harness.files)).toMatchObject({ curve: CHIP_CURVE })
  })

  it('switches to manual on setManualRpm and keeps the fixed speed until another mode is chosen', async () => {
    const harness = createHarness({ sensors: { chipC: 60 } })
    await harness.service.setCurve(CHIP_CURVE)

    const result = await harness.service.setManualRpm(0, 3000)

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('manual')
    expect(status.manualRpm).toEqual({ 0: 3000 })
    expect(status.appliedRpm).toEqual([3000, null])
    expect(leaseTargets(harness.files)).toEqual([3000, null])

    harness.sensors.chipC = 100
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([3000, null])
    expect(leaseTargets(harness.files)).toEqual([3000, null])

    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    // `manual` reuses the speeds already set per fan.
    await harness.service.setMode('manual')
    expect(leaseTargets(harness.files)).toEqual([3000, null])
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'manual' })
  })

  it('hands a fan back to macOS with rpm 0', async () => {
    const harness = createHarness()
    await harness.service.setManualRpm(0, 3000)
    await harness.service.setManualRpm(1, 4000)
    await harness.service.setManualRpm(0, 0)
    expect(leaseTargets(harness.files)).toEqual([null, 4000])
  })

  it.each([
    ['below minRpm', 0, 1000],
    ['above maxRpm', 0, 7000],
    ['not finite', 0, Number.NaN],
    ['unknown fan', 5, 3000]
  ])(
    'rejects a manual speed %s without prompting or switching mode',
    async (_label, index, rpm) => {
      const harness = createHarness()
      const result = await harness.service.setManualRpm(index, rpm)

      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-rpm' } })
      expect(expectSupported(result.status).mode).toBe('auto')
      expect(harness.runPrivileged).not.toHaveBeenCalled()
    }
  )
})

describe('FanControlService smart mode feedback', () => {
  it('raises the fans on the next tick after a hot answer and persists what it learned', async () => {
    const harness = createHarness()
    const { feedbackPrompt, appliedRpm: before } = await startSmartPrompt(harness)
    for (const rpm of before) {
      expect(rpm).not.toBeNull()
      expect(rpm).toBeLessThan(MAX_RPM)
    }

    const answered = await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'hot')

    expect(answered.ok).toBe(true)
    expect(expectSupported(answered.status).feedbackPrompt).toBeNull()
    const after = expectSupported(await harness.service.tick())
    after.appliedRpm.forEach((rpm, index) => {
      expect(rpm).toBeGreaterThan(before[index] ?? 0)
      expect(rpm).toBeLessThanOrEqual(MAX_RPM)
    })
    expect(leaseTargets(harness.files)).toEqual(after.appliedRpm)
    expect(after.smart.answers).toBe(1)
    expect(after.smart.updatedAt).toBe(harness.clock.now)
    expect(storedProfile(harness.files)).toMatchObject({
      smart: { answers: 1, learned: after.smart.learned }
    })
    expect(after.smart.learned).not.toEqual(await initialSmartPoints())
  })

  it('ignores a stale prompt id without learning', async () => {
    const harness = createHarness()
    await startSmartPrompt(harness)

    const result = await harness.service.answerFeedback('stale-prompt', 'hot')

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).smart.answers).toBe(0)
  })

  it('turns questions off through updateSettings on "never" without learning', async () => {
    const harness = createHarness()
    const { feedbackPrompt } = await startSmartPrompt(harness)

    const result = await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'never')

    expect(result.ok).toBe(true)
    expect(harness.updateSettings).toHaveBeenCalledWith({ fanSmartFeedbackPrompts: false })
    const status = expectSupported(result.status)
    expect(status.feedbackPrompt).toBeNull()
    expect(status.smart.answers).toBe(0)

    harness.clock.now += 24 * 60 * MINUTE
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('never asks while the setting is off', async () => {
    const harness = createHarness({ fanSmartFeedbackPrompts: false, sensors: { chipC: 65 } })
    await harness.service.setMode('smart')
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('drops an unanswered prompt once it expires', async () => {
    const harness = createHarness()
    await startSmartPrompt(harness)

    harness.clock.now += 4 * MINUTE
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('restores the initial smart curve on resetSmartProfile and persists it', async () => {
    const harness = createHarness()
    const fresh = expectSupported(await harness.service.getStatus())
    expect(fresh.smart).toEqual({
      learned: await initialSmartPoints(),
      answers: 0,
      updatedAt: null
    })
    const { feedbackPrompt } = await startSmartPrompt(harness)
    await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'hot')

    const result = await harness.service.resetSmartProfile()

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).smart).toEqual(fresh.smart)
    expect(storedProfile(harness.files)).toMatchObject({ smart: fresh.smart })
  })
})

describe('FanControlService profile and relaunch', () => {
  it('starts in auto with the previous mode paused and never prompts on launch', async () => {
    const harness = createHarness({
      initialFiles: profileFile({ lastMode: 'smart', manualRpm: { 0: 3200 } }),
      sensors: { chipC: 90 }
    })

    const status = expectSupported(await harness.service.getStatus())
    harness.service.setMonitoring(true)
    await harness.service.tick()

    expect(status.mode).toBe('auto')
    expect(status.pausedMode).toBe('smart')
    expect(status.session).toBe('none')
    expect(status.curve).toEqual(CHIP_CURVE)
    expect(status.manualRpm).toEqual({ 0: 3200 })
    expect(status.smart).toEqual({
      learned: STORED_SMART_POINTS,
      answers: 2,
      updatedAt: START - MINUTE
    })
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('clears the paused mode when the user reactivates it', async () => {
    const harness = createHarness({ initialFiles: profileFile({ lastMode: 'curve' }) })
    await harness.service.getStatus()

    const result = await harness.service.setMode('curve')

    expect(expectSupported(result.status).pausedMode).toBeNull()
    expect(harness.runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('forgets the paused mode for the next launch once dismissed', async () => {
    const harness = createHarness({ initialFiles: profileFile({ lastMode: 'max' }) })
    await harness.service.getStatus()

    const dismissed = expectSupported(await harness.service.dismissPausedMode())

    expect(dismissed.pausedMode).toBeNull()
    expect(dismissed.mode).toBe('auto')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'auto' })
  })

  it('persists the chosen mode so a relaunch can offer it again', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'max' })
    await harness.service.setMode('auto')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'auto' })
  })

  it('falls back to defaults when the stored profile is corrupt', async () => {
    const { DEFAULT_USER_CURVE } = await import('./fan-curve-model')
    const harness = createHarness({ initialFiles: { [PROFILE]: '{"curve": [' } })
    const status = expectSupported(await harness.service.getStatus())

    expect(status.mode).toBe('auto')
    expect(status.pausedMode).toBeNull()
    expect(status.curve).toEqual(DEFAULT_USER_CURVE)
    expect(status.manualRpm).toEqual({})
    expect(status.smart.answers).toBe(0)
  })
})

describe('FanControlService sensor polling', () => {
  it('polls every 2 s only while a mode other than auto is active or someone is watching', async () => {
    const { service, timers } = createHarness()
    await service.getStatus()
    expect(timers.active.size).toBe(0)

    service.setMonitoring(true)
    expect([...timers.active.values()]).toEqual([TICK_MS])
    service.setMonitoring(false)
    expect(timers.active.size).toBe(0)

    await service.setMode('curve')
    expect([...timers.active.values()]).toEqual([TICK_MS])
    await service.setMode('auto')
    expect(timers.active.size).toBe(0)
  })

  it('reads temperatures in auto while monitoring without opening a session', async () => {
    const harness = createHarness({ sensors: { chipC: 70, palmrestC: 33 } })
    harness.service.setMonitoring(true)

    const status = expectSupported(await harness.service.tick())

    expect(harness.runHelper).toHaveBeenCalledWith(['sensors'])
    expect(status.thermal).toMatchObject({ chipC: 70, palmrestC: 33, palmrestAvailable: true })
    expect(status.mode).toBe('auto')
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('keeps about 10 minutes of samples in the history', async () => {
    const harness = createHarness()
    harness.service.setMonitoring(true)
    await harness.service.tick()
    harness.clock.now += 5 * MINUTE
    await harness.service.tick()
    harness.clock.now += 6 * MINUTE
    await harness.service.tick()

    const history = await harness.service.getHistory()

    expect(history.map((sample) => sample.at)).toEqual([START + 5 * MINUTE, START + 11 * MINUTE])
    expect(history.every((sample) => sample.fanRpm.length === 2)).toBe(true)
  })
})

describe('FanControlService lifecycle', () => {
  it('removes the lease synchronously on quit so the root session restores auto', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    service.releaseForQuit()
    expect(files.has(LEASE)).toBe(false)
  })

  it('removes the lease on quit even while the live session sits in auto, and stops ticking', async () => {
    const { service, files, timers } = createHarness({ sensors: { chipC: 60 } })
    await service.setCurve(CHIP_CURVE)
    await service.setMode('curve')
    service.releaseForQuit()

    expect(files.has(LEASE)).toBe(false)
    expect(timers.active.size).toBe(0)
    await service.tick()
    expect(files.has(LEASE)).toBe(false)
    // The relaunch should still offer the mode that was running.
    expect(storedProfile(files)).toMatchObject({ lastMode: 'curve' })
  })

  it('removes the lease on quit after returning to auto with the session still open', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    await service.setMode('auto')
    service.releaseForQuit()
    expect(files.has(LEASE)).toBe(false)
  })

  it('hands fans to macOS while asleep and resumes the mode on wake without a new password', async () => {
    const harness = createHarness({ sensors: { chipC: 60 } })
    await harness.service.setCurve(CHIP_CURVE)
    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    await harness.service.handleSuspend()

    expect(leaseTargets(harness.files)).toEqual([null, null])
    const asleep = expectSupported(await harness.service.getStatus())
    expect(asleep.mode).toBe('curve')
    expect(asleep.session).toBe('active')
    expect(asleep.appliedRpm).toEqual([null, null])
    await harness.service.tick()
    expect(leaseTargets(harness.files)).toEqual([null, null])

    await harness.service.handleResume()

    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])
    expect(expectSupported(await harness.service.getStatus()).mode).toBe('curve')
    expect(harness.runPrivileged).toHaveBeenCalledTimes(1)
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'curve' })
  })

  it('does nothing on wake when no session was ever opened', async () => {
    const harness = createHarness()
    await harness.service.getStatus()
    await harness.service.handleSuspend()
    await harness.service.handleResume()
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('surfaces hold-exited and closes the session when fixed fans fall back to auto behind Topo', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    harness.runHelper.mockResolvedValue({ code: 0, stdout: TWO_FANS, stderr: '' })

    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('auto')
    expect(status.session).toBe('none')
    expect(status.lastError?.kind).toBe('hold-exited')
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('does not report hold-exited while every target is null and macOS owns the fans', async () => {
    const harness = createHarness({ sensors: { chipC: 30 } })
    await harness.service.setCurve(CHIP_CURVE)
    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([null, null])

    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('curve')
    expect(status.session).toBe('active')
    expect(status.lastError).toBeUndefined()
  })
})
