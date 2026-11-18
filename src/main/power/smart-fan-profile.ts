import {
  FAN_CURVE_LIMITS,
  type FanCurve,
  type FanCurvePoint,
  type FanFeedbackAnswer,
  type FanReading,
  type FanSmartProfile
} from '../../shared/fan-control-contract'
import { rpmForCurve, validateFanCurve } from './fan-curve-model'

/**
 * Smart-mode floor. T2 measured macOS turning the fans on (at minimum) with the chip near 105 °C
 * and holding the minimum at 114 °C; converted to the blend line (0.7 chip + 0.3 palm rest at ~30 °C).
 */
export const MACOS_REFERENCE_CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 83, percent: 0 },
    { tempC: 90, percent: 0 },
    { tempC: 96, percent: 100 }
  ]
}

/** Turns on around a 73 °C chip, well before macOS, and climbs fast (T2). */
export const INITIAL_SMART_CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 60, percent: 0 },
    { tempC: 70, percent: 35 },
    { tempC: 80, percent: 70 },
    { tempC: 88, percent: 100 }
  ]
}

const FEEDBACK_STEP_PERCENT = 15
const FEEDBACK_RADIUS_C = 12
/** How far a "cold" answer pushes the turn-on point once the curve is already at its minimum there. */
const COLD_TURN_ON_SHIFT_C = 3
const IMMEDIATE_BOOST_FRACTION = 0.3

// Wide RPM span so rpmForCurve's rounding is negligible when comparing curves by percent.
const PERCENT_PROBE_FAN: FanReading = { index: 0, rpm: 0, minRpm: 0, maxRpm: 1_000_000_000 }

function probe(curve: FanCurve, tempC: number): number | null {
  return rpmForCurve(curve, tempC, PERCENT_PROBE_FAN, null)
}

function withPoints(points: FanCurvePoint[]): FanCurve {
  return { source: INITIAL_SMART_CURVE.source, points }
}

/** Both curves are piecewise linear, so checking every breakpoint and the range end is exact. */
function respectsReference(curve: FanCurve): boolean {
  const temps = [...curve.points, ...MACOS_REFERENCE_CURVE.points].map((point) => point.tempC)
  temps.push(FAN_CURVE_LIMITS.maxTempC)
  return temps.every((tempC) => {
    const reference = probe(MACOS_REFERENCE_CURVE, tempC)
    if (reference === null) {
      return true
    }
    const rpm = probe(curve, tempC)
    return rpm !== null && rpm >= reference
  })
}

function isUsable(curve: FanCurve): boolean {
  return validateFanCurve(curve).ok && respectsReference(curve)
}

export function effectiveSmartCurve(profile: FanSmartProfile): FanCurve {
  const learned = withPoints(profile.learned.map((point) => ({ ...point })))
  return isUsable(learned) ? learned : INITIAL_SMART_CURVE
}

function feedbackWeight(point: FanCurvePoint, tempC: number, isLast: boolean): number {
  if (isLast && tempC >= point.tempC) {
    return 1
  }
  return Math.max(0, 1 - Math.abs(point.tempC - tempC) / FEEDBACK_RADIUS_C)
}

function raisedCurve(curve: FanCurve, tempC: number): FanCurve {
  const [first, ...rest] = curve.points
  if (tempC < first.tempC) {
    return withPoints([{ ...first, tempC: Math.max(FAN_CURVE_LIMITS.minTempC, tempC) }, ...rest])
  }
  let floor: number = FAN_CURVE_LIMITS.minPercent
  return withPoints(
    curve.points.map((point, i) => {
      const step =
        FEEDBACK_STEP_PERCENT * feedbackWeight(point, tempC, i === curve.points.length - 1)
      floor = Math.max(floor, Math.min(FAN_CURVE_LIMITS.maxPercent, point.percent + step))
      return { ...point, percent: floor }
    })
  )
}

/** Hands everything below the new turn-on point to macOS, never past where the reference starts. */
function laterTurnOnCurve(curve: FanCurve, tempC: number): FanCurve {
  const turnOn = Math.min(tempC + COLD_TURN_ON_SHIFT_C, MACOS_REFERENCE_CURVE.points[0].tempC)
  const kept = curve.points.filter((point) => point.tempC >= turnOn)
  if (kept[0]?.tempC === turnOn) {
    return withPoints(kept)
  }
  const percent = rpmToCurvePercent(probe(curve, turnOn))
  return withPoints([{ tempC: turnOn, percent }, ...kept])
}

function rpmToCurvePercent(rpm: number | null): number {
  return ((rpm ?? 0) * FAN_CURVE_LIMITS.maxPercent) / PERCENT_PROBE_FAN.maxRpm
}

/** A point never drops below the reference over the span it governs, so the floor holds between points. */
function pointFloor(points: FanCurvePoint[], i: number): number {
  const spanEnd = points[i + 1]?.tempC ?? FAN_CURVE_LIMITS.maxTempC
  return rpmToCurvePercent(probe(MACOS_REFERENCE_CURVE, spanEnd))
}

function loweredCurve(curve: FanCurve, tempC: number): FanCurve {
  const { points } = curve
  const lowered = points.map((point, i) => {
    const step = FEEDBACK_STEP_PERCENT * feedbackWeight(point, tempC, i === points.length - 1)
    const target = Math.max(
      FAN_CURVE_LIMITS.minPercent,
      point.percent - step,
      pointFloor(points, i)
    )
    return { ...point, percent: Math.min(point.percent, target) }
  })
  for (let i = lowered.length - 2; i >= 0; i--) {
    lowered[i].percent = Math.min(lowered[i].percent, lowered[i + 1].percent)
  }
  return withPoints(lowered)
}

function curveAfterFeedback(curve: FanCurve, answer: FanFeedbackAnswer, tempC: number): FanCurve {
  if (answer === 'warm') {
    return curve
  }
  if (answer === 'hot') {
    return raisedCurve(curve, tempC)
  }
  const rpm = probe(curve, tempC)
  if (rpm === null) {
    return curve
  }
  return rpm === PERCENT_PROBE_FAN.minRpm
    ? laterTurnOnCurve(curve, tempC)
    : loweredCurve(curve, tempC)
}

export function applyFeedback(
  profile: FanSmartProfile,
  answer: FanFeedbackAnswer,
  tempC: number
): FanSmartProfile {
  const current = effectiveSmartCurve(profile)
  const next = Number.isFinite(tempC) ? curveAfterFeedback(current, answer, tempC) : current
  const learned = isUsable(next) ? next.points : current.points
  return {
    ...profile,
    learned: learned.map((point) => ({ ...point })),
    answers: profile.answers + 1
  }
}

/** Raises a fan right away after a "hot" answer, before the learned curve takes over. */
export function immediateBoostRpm(fan: FanReading, currentRpm: number): number {
  const base = Math.max(fan.minRpm, currentRpm)
  const boosted = Math.round(base + (fan.maxRpm - fan.minRpm) * IMMEDIATE_BOOST_FRACTION)
  return Math.min(fan.maxRpm, boosted)
}
