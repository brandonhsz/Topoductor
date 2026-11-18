import { describe, expect, it } from 'vitest'
import type { FanCurve, FanCurvePoint, FanReading } from '../../shared/fan-control-contract'
import {
  DEFAULT_USER_CURVE,
  percentToRpm,
  rpmForCurve,
  rpmToPercent,
  validateFanCurve
} from './fan-curve-model'

const M2_PRO_FAN: FanReading = { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 }
// Round range so interpolated targets are exact integers.
const ROUND_FAN: FanReading = { index: 1, rpm: 0, minRpm: 2000, maxRpm: 6000 }

function curve(points: FanCurvePoint[], source: FanCurve['source'] = 'blend'): FanCurve {
  return { source, points }
}

const LINEAR = curve([
  { tempC: 40, percent: 0 },
  { tempC: 60, percent: 50 },
  { tempC: 80, percent: 100 }
])

describe('validateFanCurve', () => {
  it('accepts a well-formed curve', () => {
    expect(validateFanCurve(LINEAR)).toEqual({ ok: true })
  })

  it('accepts the 2- and 6-point boundaries and the 20–110 °C edges', () => {
    expect(
      validateFanCurve(
        curve([
          { tempC: 20, percent: 0 },
          { tempC: 110, percent: 100 }
        ])
      )
    ).toEqual({ ok: true })
    expect(
      validateFanCurve(
        curve([
          { tempC: 30, percent: 0 },
          { tempC: 40, percent: 10 },
          { tempC: 50, percent: 20 },
          { tempC: 60, percent: 40 },
          { tempC: 70, percent: 70 },
          { tempC: 80, percent: 100 }
        ])
      )
    ).toEqual({ ok: true })
  })

  it('accepts flat segments because percent only has to be non-decreasing', () => {
    expect(
      validateFanCurve(
        curve([
          { tempC: 50, percent: 30 },
          { tempC: 60, percent: 30 },
          { tempC: 70, percent: 60 }
        ])
      )
    ).toEqual({ ok: true })
  })

  it.each<[string, FanCurvePoint[]]>([
    ['fewer than 2 points', [{ tempC: 50, percent: 0 }]],
    [
      'more than 6 points',
      [30, 40, 50, 60, 70, 80, 90].map((tempC, i) => ({ tempC, percent: i * 10 }))
    ],
    [
      'repeated temperatures',
      [
        { tempC: 50, percent: 0 },
        { tempC: 50, percent: 40 }
      ]
    ],
    [
      'decreasing temperatures',
      [
        { tempC: 70, percent: 0 },
        { tempC: 50, percent: 40 }
      ]
    ],
    [
      'a temperature below 20 °C',
      [
        { tempC: 19, percent: 0 },
        { tempC: 50, percent: 40 }
      ]
    ],
    [
      'a temperature above 110 °C',
      [
        { tempC: 50, percent: 0 },
        { tempC: 111, percent: 100 }
      ]
    ],
    [
      'a negative percent',
      [
        { tempC: 50, percent: -1 },
        { tempC: 60, percent: 40 }
      ]
    ],
    [
      'a percent above 100',
      [
        { tempC: 50, percent: 0 },
        { tempC: 60, percent: 101 }
      ]
    ],
    [
      'decreasing percent',
      [
        { tempC: 50, percent: 60 },
        { tempC: 60, percent: 40 }
      ]
    ],
    [
      'a non-finite value',
      [
        { tempC: 50, percent: 0 },
        { tempC: Number.NaN, percent: 40 }
      ]
    ]
  ])('rejects %s with a detail', (_label, points) => {
    const result = validateFanCurve(curve(points))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).toEqual(expect.any(String))
      expect(result.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('DEFAULT_USER_CURVE', () => {
  it('is valid and drawn against the blend line', () => {
    expect(validateFanCurve(DEFAULT_USER_CURVE)).toEqual({ ok: true })
    expect(DEFAULT_USER_CURVE.source).toBe('blend')
  })
})

describe('percentToRpm / rpmToPercent', () => {
  it('maps 0 % to minRpm and 100 % to maxRpm, never to 0 rpm', () => {
    expect(percentToRpm(0, M2_PRO_FAN)).toBe(2317)
    expect(percentToRpm(100, M2_PRO_FAN)).toBe(6800)
    expect(rpmToPercent(2317, M2_PRO_FAN)).toBe(0)
    expect(rpmToPercent(6800, M2_PRO_FAN)).toBe(100)
  })

  it('is linear across the fan range', () => {
    expect(percentToRpm(50, ROUND_FAN)).toBe(4000)
    expect(percentToRpm(25, ROUND_FAN)).toBe(3000)
    expect(rpmToPercent(5000, ROUND_FAN)).toBe(75)
  })

  it('returns whole rpm targets', () => {
    for (const percent of [0, 13, 33.3, 50, 77, 100]) {
      expect(Number.isInteger(percentToRpm(percent, M2_PRO_FAN))).toBe(true)
    }
  })

  it('round-trips both ways', () => {
    for (const percent of [0, 10, 33, 50, 72.5, 100]) {
      expect(rpmToPercent(percentToRpm(percent, M2_PRO_FAN), M2_PRO_FAN)).toBeCloseTo(percent, 1)
    }
    for (const rpm of [2317, 2500, 3500, 4999, 6800]) {
      expect(percentToRpm(rpmToPercent(rpm, M2_PRO_FAN), M2_PRO_FAN)).toBe(rpm)
    }
  })

  it('uses each fan’s own range', () => {
    const other: FanReading = { index: 1, rpm: 0, minRpm: 2500, maxRpm: 6500 }
    expect(percentToRpm(0, other)).toBe(2500)
    expect(percentToRpm(100, other)).toBe(6500)
  })
})

describe('rpmForCurve', () => {
  it('interpolates linearly between points', () => {
    expect(rpmForCurve(LINEAR, 50, ROUND_FAN, null)).toBe(3000)
    expect(rpmForCurve(LINEAR, 60, ROUND_FAN, null)).toBe(4000)
    expect(rpmForCurve(LINEAR, 70, ROUND_FAN, null)).toBe(5000)
  })

  it('starts at minRpm (0 %) right at the turn-on threshold', () => {
    expect(rpmForCurve(LINEAR, 40, ROUND_FAN, null)).toBe(2000)
    expect(rpmForCurve(LINEAR, 40, M2_PRO_FAN, null)).toBe(2317)
  })

  it('holds the last point above the curve', () => {
    expect(rpmForCurve(LINEAR, 80, ROUND_FAN, null)).toBe(6000)
    expect(rpmForCurve(LINEAR, 105, ROUND_FAN, null)).toBe(6000)
  })

  it('hands the fan to macOS (null) below the threshold while it is not controlled', () => {
    expect(rpmForCurve(LINEAR, 39.9, ROUND_FAN, null)).toBeNull()
    expect(rpmForCurve(LINEAR, 38, ROUND_FAN, null)).toBeNull()
    expect(rpmForCurve(LINEAR, 25, ROUND_FAN, null)).toBeNull()
  })

  it('keeps control down to 3 °C below the threshold once it is on', () => {
    expect(rpmForCurve(LINEAR, 39, ROUND_FAN, 2000)).toBe(2000)
    expect(rpmForCurve(LINEAR, 37.5, ROUND_FAN, 2400)).toBe(2000)
    expect(rpmForCurve(LINEAR, 37, ROUND_FAN, 2000)).toBe(2000)
    expect(rpmForCurve(LINEAR, 36.9, ROUND_FAN, 2000)).toBeNull()
  })

  it('measures the 3 °C hysteresis from each curve’s own first point', () => {
    const late = curve([
      { tempC: 60, percent: 0 },
      { tempC: 90, percent: 100 }
    ])
    expect(rpmForCurve(late, 57.5, ROUND_FAN, 2000)).toBe(2000)
    expect(rpmForCurve(late, 56.5, ROUND_FAN, 2000)).toBeNull()
    expect(rpmForCurve(late, 57.5, ROUND_FAN, null)).toBeNull()
  })

  it('does not toggle while the temperature hovers around the threshold', () => {
    const temps = [39.5, 40.5, 39, 40.2, 38, 39.8, 37.2, 36.5, 39, 39.9, 40]
    let previous: number | null = null
    const handedToMacos: boolean[] = []
    for (const tempC of temps) {
      previous = rpmForCurve(LINEAR, tempC, ROUND_FAN, previous)
      handedToMacos.push(previous === null)
    }
    expect(handedToMacos).toEqual([
      true, // 39.5: still off
      false, // 40.5: turns on
      false,
      false,
      false,
      false,
      false, // 37.2: inside the 3 °C band
      true, // 36.5: turns off
      true, // 39: off again, no hysteresis on the way up
      true,
      false // 40: turns on again
    ])
  })

  it('never decreases as the temperature rises', () => {
    const custom = curve([
      { tempC: 45, percent: 10 },
      { tempC: 55, percent: 10 },
      { tempC: 70, percent: 60 },
      { tempC: 85, percent: 100 }
    ])
    let last = 0
    for (let tempC = 45; tempC <= 110; tempC += 0.5) {
      const rpm = rpmForCurve(custom, tempC, M2_PRO_FAN, null)
      expect(rpm).not.toBeNull()
      expect(rpm!).toBeGreaterThanOrEqual(last)
      expect(rpm!).toBeGreaterThanOrEqual(M2_PRO_FAN.minRpm)
      expect(rpm!).toBeLessThanOrEqual(M2_PRO_FAN.maxRpm)
      last = rpm!
    }
  })
})
