import {
  FAN_CURVE_LIMITS,
  type FanCurve,
  type FanCurvePoint,
  type FanReading
} from '../../shared/fan-control-contract'

/** Degrees below the first point a controlled fan keeps running before macOS takes it back. */
export const FAN_CURVE_HYSTERESIS_C = 3

export const DEFAULT_USER_CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 55, percent: 0 },
    { tempC: 65, percent: 30 },
    { tempC: 75, percent: 65 },
    { tempC: 85, percent: 100 }
  ]
}

export type FanCurveValidation = { ok: true } | { ok: false; detail: string }

function pointProblem(point: FanCurvePoint, previous: FanCurvePoint | undefined): string | null {
  const { tempC, percent } = point
  if (!Number.isFinite(tempC) || !Number.isFinite(percent)) {
    return 'curve points must be finite numbers'
  }
  if (tempC < FAN_CURVE_LIMITS.minTempC || tempC > FAN_CURVE_LIMITS.maxTempC) {
    return `temperatures must be within ${FAN_CURVE_LIMITS.minTempC}–${FAN_CURVE_LIMITS.maxTempC} °C`
  }
  if (percent < FAN_CURVE_LIMITS.minPercent || percent > FAN_CURVE_LIMITS.maxPercent) {
    return `percent must be within ${FAN_CURVE_LIMITS.minPercent}–${FAN_CURVE_LIMITS.maxPercent}`
  }
  if (previous && tempC <= previous.tempC) {
    return 'temperatures must strictly increase'
  }
  if (previous && percent < previous.percent) {
    return 'percent must not decrease as temperature rises'
  }
  return null
}

export function validateFanCurve(curve: FanCurve): FanCurveValidation {
  const { points } = curve
  if (points.length < FAN_CURVE_LIMITS.minPoints || points.length > FAN_CURVE_LIMITS.maxPoints) {
    return {
      ok: false,
      detail: `a curve needs ${FAN_CURVE_LIMITS.minPoints}–${FAN_CURVE_LIMITS.maxPoints} points`
    }
  }
  for (let i = 0; i < points.length; i++) {
    const detail = pointProblem(points[i], points[i - 1])
    if (detail) {
      return { ok: false, detail }
    }
  }
  return { ok: true }
}

export function percentToRpm(percent: number, fan: FanReading): number {
  return Math.round(fan.minRpm + ((fan.maxRpm - fan.minRpm) * percent) / 100)
}

export function rpmToPercent(rpm: number, fan: FanReading): number {
  return ((rpm - fan.minRpm) * 100) / (fan.maxRpm - fan.minRpm)
}

function percentForCurve(points: FanCurvePoint[], tempC: number): number {
  const first = points[0]
  if (tempC <= first.tempC) {
    return first.percent
  }
  for (let i = 1; i < points.length; i++) {
    const upper = points[i]
    if (tempC <= upper.tempC) {
      const lower = points[i - 1]
      const t = (tempC - lower.tempC) / (upper.tempC - lower.tempC)
      return lower.percent + (upper.percent - lower.percent) * t
    }
  }
  return (points.at(-1) ?? first).percent
}

/** `previous` is the last target for this fan; null means macOS held it, so no hysteresis applies. */
export function rpmForCurve(
  curve: FanCurve,
  tempC: number,
  fan: FanReading,
  previous: number | null
): number | null {
  const threshold = curve.points[0].tempC
  const turnOff = previous === null ? threshold : threshold - FAN_CURVE_HYSTERESIS_C
  if (tempC < turnOff) {
    return null
  }
  const percent = Math.min(
    FAN_CURVE_LIMITS.maxPercent,
    Math.max(FAN_CURVE_LIMITS.minPercent, percentForCurve(curve.points, tempC))
  )
  return percentToRpm(percent, fan)
}
