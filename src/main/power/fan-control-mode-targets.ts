import type {
  FanControlMode,
  FanCurve,
  FanReading,
  FanSmartProfile,
  ThermalReading
} from '../../shared/fan-control-contract'
import { rpmForCurve } from './fan-curve-model'
import { effectiveSmartCurve, immediateBoostRpm } from './smart-fan-profile'
import { readingFor } from './thermal-blend'

/** How long a "hot" answer keeps the fans boosted before the learned curve takes over again. */
export const HOT_BOOST_HOLD_MS = 2 * 60_000

export type FanHotBoost = { until: number; rpm: number[] }

export type FanModeTargetsInput = {
  mode: FanControlMode
  fans: FanReading[]
  thermal: ThermalReading
  curve: FanCurve
  smart: FanSmartProfile
  manualRpm: Record<number, number>
  /** Last target per fan, so a running fan keeps the curve's hysteresis. */
  previous: (number | null)[]
  hotBoost: FanHotBoost | null
}

export function hotBoostFor(
  fans: FanReading[],
  applied: (number | null)[],
  now: number
): FanHotBoost {
  return {
    until: now + HOT_BOOST_HOLD_MS,
    rpm: fans.map((fan, i) => immediateBoostRpm(fan, applied[i] ?? fan.rpm))
  }
}

function curveTargets(
  curve: FanCurve,
  { fans, thermal, previous }: FanModeTargetsInput
): (number | null)[] {
  // Without a palm-rest sensor the chip is the only reading left.
  const tempC = readingFor(curve.source, thermal) ?? thermal.chipC
  return fans.map((fan, i) =>
    tempC === null ? null : rpmForCurve(curve, tempC, fan, previous[i] ?? null)
  )
}

function smartTargets(input: FanModeTargetsInput): (number | null)[] {
  const targets = curveTargets(effectiveSmartCurve(input.smart), input)
  const boost = input.hotBoost?.rpm
  return boost ? targets.map((rpm, i) => Math.max(rpm ?? 0, boost[i] ?? 0) || null) : targets
}

/** Lease targets for the active mode; null hands that fan to macOS. */
export function fanTargetsFor(input: FanModeTargetsInput): (number | null)[] {
  switch (input.mode) {
    case 'auto':
      return input.fans.map(() => null)
    case 'max':
      return input.fans.map((fan) => fan.maxRpm)
    case 'curve':
      return curveTargets(input.curve, input)
    case 'smart':
      return smartTargets(input)
    case 'manual':
      return input.fans.map((fan) => input.manualRpm[fan.index] || null)
  }
}

/** Why a manual speed is refused; rpm 0 hands the fan back to macOS. */
export function manualRpmProblem(
  fan: FanReading | undefined,
  index: number,
  rpm: number
): string | null {
  if (!fan) {
    return `unknown fan ${index}`
  }
  if (!Number.isFinite(rpm) || (rpm !== 0 && (rpm < fan.minRpm || rpm > fan.maxRpm))) {
    return `rpm must be 0 or within ${fan.minRpm}–${fan.maxRpm}`
  }
  return null
}
