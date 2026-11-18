import { describe, expect, it } from 'vitest'
import type {
  FanCurve,
  FanFeedbackAnswer,
  FanReading,
  FanSmartProfile
} from '../../shared/fan-control-contract'
import { rpmForCurve, validateFanCurve } from './fan-curve-model'
import {
  INITIAL_SMART_CURVE,
  MACOS_REFERENCE_CURVE,
  applyFeedback,
  effectiveSmartCurve,
  immediateBoostRpm
} from './smart-fan-profile'

const FAN: FanReading = { index: 0, rpm: 2317, minRpm: 2317, maxRpm: 6800 }
const GRID: number[] = Array.from({ length: 181 }, (_, i) => 20 + i * 0.5)

function rpmAt(curve: FanCurve, tempC: number): number | null {
  return rpmForCurve(curve, tempC, FAN, null)
}

function initialProfile(): FanSmartProfile {
  return {
    learned: INITIAL_SMART_CURVE.points.map((point) => ({ ...point })),
    answers: 0,
    updatedAt: null
  }
}

function answerRepeatedly(
  profile: FanSmartProfile,
  answer: FanFeedbackAnswer,
  tempsC: number[],
  rounds: number
): FanSmartProfile {
  let next = profile
  for (let round = 0; round < rounds; round += 1) {
    for (const tempC of tempsC) {
      next = applyFeedback(next, answer, tempC)
    }
  }
  return next
}

function expectAtOrAboveReference(curve: FanCurve): void {
  for (const tempC of GRID) {
    const reference = rpmAt(MACOS_REFERENCE_CURVE, tempC)
    if (reference === null) {
      continue
    }
    const rpm = rpmAt(curve, tempC)
    expect(rpm, `${tempC} °C hands to macOS while the reference does not`).not.toBeNull()
    expect(rpm!, `${tempC} °C below the macOS reference`).toBeGreaterThanOrEqual(reference)
  }
}

describe('reference and initial curves', () => {
  it('are both valid curves', () => {
    expect(validateFanCurve(MACOS_REFERENCE_CURVE)).toEqual({ ok: true })
    expect(validateFanCurve(INITIAL_SMART_CURVE)).toEqual({ ok: true })
  })

  it('leaves everyday temperatures to macOS in the reference, as measured in T2', () => {
    expect(rpmAt(MACOS_REFERENCE_CURVE, 60)).toBeNull()
    expect(rpmAt(MACOS_REFERENCE_CURVE, 75)).toBeNull()
  })

  it('turns the initial smart curve on earlier than macOS', () => {
    expect(INITIAL_SMART_CURVE.points[0].tempC).toBeLessThan(MACOS_REFERENCE_CURVE.points[0].tempC)
    expect(rpmAt(INITIAL_SMART_CURVE, 75)).not.toBeNull()
  })

  it('keeps the initial smart curve at or above the reference everywhere', () => {
    expectAtOrAboveReference(INITIAL_SMART_CURVE)
  })
})

describe('effectiveSmartCurve', () => {
  it('follows the learned points', () => {
    const curve = effectiveSmartCurve(initialProfile())
    for (const tempC of GRID) {
      expect(rpmAt(curve, tempC)).toBe(rpmAt(INITIAL_SMART_CURVE, tempC))
    }
  })

  it('falls back to the initial smart curve when nothing has been learned', () => {
    const curve = effectiveSmartCurve({ learned: [], answers: 0, updatedAt: null })
    expect(validateFanCurve(curve)).toEqual({ ok: true })
    for (const tempC of GRID) {
      expect(rpmAt(curve, tempC)).toBe(rpmAt(INITIAL_SMART_CURVE, tempC))
    }
  })
})

describe('applyFeedback', () => {
  it('counts every answer and leaves the input profile untouched', () => {
    const profile = initialProfile()
    const snapshot = structuredClone(profile)
    const answers: FanFeedbackAnswer[] = ['hot', 'warm', 'cold']
    let next = profile
    for (const answer of answers) {
      next = applyFeedback(next, answer, 70)
    }
    expect(next.answers).toBe(3)
    expect(profile).toEqual(snapshot)
  })

  it('“warm” confirms the curve without changing it', () => {
    const before = effectiveSmartCurve(initialProfile())
    const after = effectiveSmartCurve(applyFeedback(initialProfile(), 'warm', 70))
    for (const tempC of GRID) {
      expect(rpmAt(after, tempC)).toBe(rpmAt(before, tempC))
    }
  })

  it('“hot” raises the curve at that temperature and lowers it nowhere', () => {
    const before = effectiveSmartCurve(initialProfile())
    const after = effectiveSmartCurve(applyFeedback(initialProfile(), 'hot', 70))
    expect(validateFanCurve(after)).toEqual({ ok: true })
    expect(rpmAt(after, 70)!).toBeGreaterThan(rpmAt(before, 70)!)
    for (const tempC of GRID) {
      const was = rpmAt(before, tempC)
      if (was === null) {
        continue
      }
      expect(rpmAt(after, tempC), `${tempC} °C`).not.toBeNull()
      expect(rpmAt(after, tempC)!, `${tempC} °C`).toBeGreaterThanOrEqual(was)
    }
  })

  it('“hot” below the turn-on point turns the fans on there', () => {
    const tempC = INITIAL_SMART_CURVE.points[0].tempC - 4
    expect(rpmAt(INITIAL_SMART_CURVE, tempC)).toBeNull()
    const after = effectiveSmartCurve(applyFeedback(initialProfile(), 'hot', tempC))
    expect(validateFanCurve(after)).toEqual({ ok: true })
    expect(rpmAt(after, tempC)).not.toBeNull()
  })

  it('repeated “hot” saturates at maxRpm and stays a valid curve', () => {
    const profile = answerRepeatedly(initialProfile(), 'hot', [65, 75, 85, 95], 30)
    const curve = effectiveSmartCurve(profile)
    expect(validateFanCurve(curve)).toEqual({ ok: true })
    expect(rpmAt(curve, 75)).toBe(FAN.maxRpm)
  })

  it('“cold” lowers the curve at that temperature and raises it nowhere', () => {
    const before = effectiveSmartCurve(initialProfile())
    const after = effectiveSmartCurve(applyFeedback(initialProfile(), 'cold', 80))
    expect(validateFanCurve(after)).toEqual({ ok: true })
    const at80 = rpmAt(after, 80)
    expect(at80 === null || at80 < rpmAt(before, 80)!).toBe(true)
    for (const tempC of GRID) {
      const now = rpmAt(after, tempC)
      if (now === null) {
        continue
      }
      expect(rpmAt(before, tempC), `${tempC} °C`).not.toBeNull()
      expect(now, `${tempC} °C`).toBeLessThanOrEqual(rpmAt(before, tempC)!)
    }
  })

  it('repeated “cold” never crosses the macOS reference', () => {
    const profile = answerRepeatedly(initialProfile(), 'cold', [65, 75, 85, 95, 100, 105, 110], 60)
    const curve = effectiveSmartCurve(profile)
    expect(validateFanCurve(curve)).toEqual({ ok: true })
    expectAtOrAboveReference(curve)
  })

  it('repeated “cold” reaches macOS (null) only where the reference is null too', () => {
    const profile = answerRepeatedly(initialProfile(), 'cold', [65, 75, 85, 95, 100, 105, 110], 60)
    const curve = effectiveSmartCurve(profile)
    expect(rpmAt(curve, 75)).toBeNull()
    for (const tempC of GRID) {
      if (rpmAt(curve, tempC) === null) {
        expect(rpmAt(MACOS_REFERENCE_CURVE, tempC), `${tempC} °C`).toBeNull()
      }
    }
  })
})

describe('immediateBoostRpm', () => {
  it('raises a running fan right away without passing maxRpm', () => {
    for (const current of [2317, 3500, 6700]) {
      const boosted = immediateBoostRpm(FAN, current)
      expect(boosted).toBeGreaterThan(current)
      expect(boosted).toBeLessThanOrEqual(FAN.maxRpm)
      expect(Number.isInteger(boosted)).toBe(true)
    }
  })

  it('starts a stopped fan at least at minRpm', () => {
    const boosted = immediateBoostRpm(FAN, 0)
    expect(boosted).toBeGreaterThanOrEqual(FAN.minRpm)
    expect(boosted).toBeLessThanOrEqual(FAN.maxRpm)
  })

  it('stays at maxRpm when the fan is already there', () => {
    expect(immediateBoostRpm(FAN, FAN.maxRpm)).toBe(FAN.maxRpm)
  })
})
