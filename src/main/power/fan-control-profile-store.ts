import {
  FAN_CONTROL_MODES,
  TEMPERATURE_SOURCES,
  type FanControlActiveMode,
  type FanControlMode,
  type FanCurve,
  type FanCurvePoint,
  type FanSmartProfile
} from '../../shared/fan-control-contract'
import { DEFAULT_USER_CURVE, validateFanCurve } from './fan-curve-model'
import { INITIAL_SMART_CURVE } from './smart-fan-profile'

/** What survives a relaunch: `lastMode` is offered back paused, never resumed on its own. */
export type FanControlProfile = {
  curve: FanCurve
  smart: FanSmartProfile
  manualRpm: Record<number, number>
  lastMode: FanControlMode
}

export type FanControlProfileStoreDeps = {
  path: string
  fs: {
    writeFile: (path: string, data: string) => Promise<void>
    readFile: (path: string) => Promise<string | null>
    rename: (from: string, to: string) => Promise<void>
  }
}

function clonePoints(points: readonly FanCurvePoint[]): FanCurvePoint[] {
  return points.map((point) => ({ ...point }))
}

export function cloneFanCurve(curve: FanCurve): FanCurve {
  return { source: curve.source, points: clonePoints(curve.points) }
}

export function initialSmartProfile(): FanSmartProfile {
  return { learned: clonePoints(INITIAL_SMART_CURVE.points), answers: 0, updatedAt: null }
}

export function defaultFanControlProfile(): FanControlProfile {
  return {
    curve: cloneFanCurve(DEFAULT_USER_CURVE),
    smart: initialSmartProfile(),
    manualRpm: {},
    lastMode: 'auto'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePoints(value: unknown): FanCurvePoint[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const points: FanCurvePoint[] = []
  for (const point of value) {
    if (!isRecord(point) || typeof point.tempC !== 'number' || typeof point.percent !== 'number') {
      return null
    }
    points.push({ tempC: point.tempC, percent: point.percent })
  }
  return points
}

function parseCurve(value: unknown): FanCurve | null {
  if (!isRecord(value)) {
    return null
  }
  const source = TEMPERATURE_SOURCES.find((candidate) => candidate === value.source)
  const points = parsePoints(value.points)
  if (!source || !points) {
    return null
  }
  const curve: FanCurve = { source, points }
  return validateFanCurve(curve).ok ? curve : null
}

function parseSmart(value: unknown): FanSmartProfile | null {
  if (!isRecord(value)) {
    return null
  }
  const learned = parsePoints(value.learned)
  const { answers, updatedAt } = value
  if (!learned || typeof answers !== 'number' || !Number.isInteger(answers) || answers < 0) {
    return null
  }
  if (updatedAt !== null && typeof updatedAt !== 'number') {
    return null
  }
  return { learned, answers, updatedAt }
}

function parseManualRpm(value: unknown): Record<number, number> | null {
  if (!isRecord(value)) {
    return null
  }
  const manualRpm: Record<number, number> = {}
  for (const [key, rpm] of Object.entries(value)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || typeof rpm !== 'number' || !(rpm > 0)) {
      return null
    }
    manualRpm[index] = rpm
  }
  return manualRpm
}

/** All or nothing: a partially valid file falls back to every default. */
export function parseFanControlProfile(raw: string): FanControlProfile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }
  const stored = parsed
  const curve = parseCurve(stored.curve)
  const smart = parseSmart(stored.smart)
  const manualRpm = parseManualRpm(stored.manualRpm)
  const lastMode = FAN_CONTROL_MODES.find((mode) => mode === stored.lastMode)
  if (!curve || !smart || !manualRpm || !lastMode) {
    return null
  }
  return { curve, smart, manualRpm, lastMode }
}

/** In-memory profile loaded once from disk; every update is persisted before it resolves. */
export class FanControlProfileStore {
  current: FanControlProfile = defaultFanControlProfile()
  /** Mode from the previous run, offered back until the user reactivates or dismisses it. */
  pausedMode: FanControlActiveMode | null = null
  private readonly deps: FanControlProfileStoreDeps
  private loading: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  private queued: string | null = null

  constructor(deps: FanControlProfileStoreDeps) {
    this.deps = deps
  }

  ensureLoaded(): Promise<void> {
    this.loading ??= this.load().then((profile) => {
      this.current = profile
      this.pausedMode = profile.lastMode === 'auto' ? null : profile.lastMode
    })
    return this.loading
  }

  update(patch: Partial<FanControlProfile>): Promise<void> {
    this.current = { ...this.current, ...patch }
    return this.save(this.current)
  }

  private async load(): Promise<FanControlProfile> {
    let raw: string | null = null
    try {
      raw = await this.deps.fs.readFile(this.deps.path)
    } catch (error) {
      console.warn('[fan-control] Failed to read the fan profile:', error)
    }
    return (raw === null ? null : parseFanControlProfile(raw)) ?? defaultFanControlProfile()
  }

  /** Serialized tmp + rename so a crash mid-write never leaves a torn profile; a queued write takes the newest data. */
  private save(profile: FanControlProfile): Promise<void> {
    const alreadyQueued = this.queued !== null
    this.queued = JSON.stringify(profile)
    if (!alreadyQueued) {
      this.writes = this.writes.then(() => {
        const data = this.queued ?? ''
        this.queued = null
        return this.write(data)
      })
    }
    return this.writes
  }

  private async write(data: string): Promise<void> {
    const tmpPath = `${this.deps.path}.tmp`
    try {
      await this.deps.fs.writeFile(tmpPath, data)
      await this.deps.fs.rename(tmpPath, this.deps.path)
    } catch (error) {
      console.warn('[fan-control] Failed to save the fan profile:', error)
    }
  }
}
