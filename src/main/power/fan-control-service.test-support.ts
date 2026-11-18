import { expect, vi, type Mock } from 'vitest'
import type {
  FanControlGlobalSettings,
  FanControlStatus,
  FanControlTargets,
  FanCurve,
  FanCurvePoint
} from '../../shared/fan-control-contract'
import { FanControlService, type FanControlServiceDeps } from './fan-control-service'

export const HELPER = '/Applications/Topo.app/Contents/MacOS/topo-fan-control'
export const LEASE = '/Users/me/Library/Application Support/topo/fan-control.lease'
export const PROFILE = '/Users/me/Library/Application Support/topo/fan-control-profile.json'
export const MIN_RPM = 2317
export const MAX_RPM = 6800
export const TICK_MS = 2_000
export const MINUTE = 60_000
export const START = Date.UTC(2026, 10, 17, 15, 0, 0)

export const TWO_FAN_READINGS = [
  { index: 0, rpm: 2300, minRpm: MIN_RPM, maxRpm: MAX_RPM },
  { index: 1, rpm: 2500, minRpm: MIN_RPM, maxRpm: MAX_RPM }
]
export const TWO_FANS = JSON.stringify({ mode: 'auto', fans: TWO_FAN_READINGS })

// Drawn against the raw chip line so expected targets do not depend on the blend weights.
// Pure modules are imported per test so the still-valid service tests load before they exist.
export async function initialSmartPoints(): Promise<FanCurvePoint[]> {
  const { INITIAL_SMART_CURVE } = await import('./smart-fan-profile')
  return curvePoints(INITIAL_SMART_CURVE)
}

export const STORED_SMART_POINTS: FanCurvePoint[] = [
  { tempC: 55, percent: 0 },
  { tempC: 85, percent: 100 }
]

export const CHIP_CURVE: FanCurve = {
  source: 'chip',
  points: [
    { tempC: 40, percent: 0 },
    { tempC: 60, percent: 100 }
  ]
}

export type RunHelper = FanControlServiceDeps['runHelper']
export type RunPrivileged = FanControlServiceDeps['runPrivileged']
export type SupportedStatus = Extract<FanControlStatus, { supported: true }>
export type Sensors = { chipC: number; palmrestC: number | null }

export type FakeTimers = {
  setInterval: Mock<(callback: () => void, ms: number) => unknown>
  clearInterval: Mock<(handle: unknown) => void>
  active: Map<unknown, number>
}

export type Harness = {
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

export type HarnessOverrides = Partial<
  Omit<FanControlServiceDeps, 'runHelper' | 'runPrivileged' | 'updateSettings'>
> & {
  runHelper?: Mock<RunHelper>
  runPrivileged?: (files: Map<string, string>) => Mock<RunPrivileged>
  initialFiles?: Record<string, string>
  fanSmartFeedbackPrompts?: boolean
  sensors?: Partial<Sensors>
  fans?: typeof TWO_FAN_READINGS
}

export function sensorsOutput({ chipC, palmrestC }: Sensors): string {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Only `targets` is checked so a malformed version still reaches the `v` assertion.
export function isFanControlTargets(value: unknown): value is FanControlTargets {
  return isRecord(value) && 'targets' in value
}

export function parseLease(raw: string | undefined): FanControlTargets | null {
  if (raw === undefined) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw.trim())
    return isFanControlTargets(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createTimers(): FakeTimers {
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

export function createHarness(overrides: HarnessOverrides = {}): Harness {
  const {
    runHelper: helperOverride,
    runPrivileged: privilegedOverride,
    initialFiles,
    fanSmartFeedbackPrompts = true,
    sensors: sensorOverrides,
    fans = TWO_FAN_READINGS,
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
        stdout: JSON.stringify({ mode: forced ? 'manual' : 'auto', fans }),
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

export function expectSupported(status: FanControlStatus): SupportedStatus {
  if (!status.supported) {
    throw new Error(`expected a supported status, got ${status.reason}`)
  }
  return status
}

export function leaseTargets(files: Map<string, string>): (number | null)[] {
  const lease = parseLease(files.get(LEASE))
  if (!lease) {
    throw new Error(`expected a targets line in the lease, got ${files.get(LEASE)}`)
  }
  expect(lease.v).toBe(1)
  return lease.targets
}

export function storedProfile(files: Map<string, string>): Record<string, unknown> {
  const raw = files.get(PROFILE)
  if (raw === undefined) {
    throw new Error('expected the profile to be persisted')
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    throw new Error('expected the persisted profile to be an object')
  }
  return parsed
}

export function profileFile(profile: {
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
export function curvePoints(curve: FanCurve | readonly FanCurvePoint[]): FanCurvePoint[] {
  return 'points' in curve ? [...curve.points] : [...curve]
}

export async function startSmartPrompt(harness: Harness): Promise<SupportedStatus> {
  harness.sensors.chipC = 65
  await harness.service.setMode('smart')
  const status = expectSupported(await harness.service.tick())
  expect(status.feedbackPrompt).not.toBeNull()
  return status
}

export function sensorReads(harness: Harness): number {
  return harness.runHelper.mock.calls.filter(([args]) => args[0] === 'sensors').length
}

export function fireInterval(harness: Harness): void {
  const tick = harness.timers.setInterval.mock.calls.at(-1)?.[0]
  if (!tick) {
    throw new Error('expected a polling interval')
  }
  tick()
}

export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
