import { describe, expect, it } from 'vitest'
import type {
  FanControlHelperSensorsOutput,
  ThermalReading
} from '../../shared/fan-control-contract'
import {
  BLEND_CHIP_WEIGHT,
  CHIP_FALL_TAU_S,
  CHIP_RISE_TAU_S,
  blendTemperature,
  readingFor,
  selectThermalReading
} from './thermal-blend'

// Exponential approach with the T2 time constants (rise 10 s, fall 45 s).
function approach(previous: number, target: number, elapsedS: number, tauS: number): number {
  return previous + (target - previous) * (1 - Math.exp(-elapsedS / tauS))
}

function runFor(
  start: number,
  chipC: number,
  palmrestC: number | null,
  totalS: number,
  stepS = 2
): number {
  let blend = start
  for (let t = 0; t < totalS; t += stepS) {
    blend = blendTemperature(chipC, palmrestC, blend, stepS)
  }
  return blend
}

const M2_PRO_SENSORS: FanControlHelperSensorsOutput = {
  chip: [
    { key: 'Tp01', c: 55.2 },
    { key: 'Te05', c: 81.4 },
    { key: 'Tp09', c: 62 }
  ],
  palmrest: [
    { key: 'Ts0P', c: 32 },
    { key: 'Ts1P', c: 34 }
  ],
  battery: [{ key: 'TB0T', c: 95 }]
}

describe('blend constants', () => {
  it('match the weights measured by the T2 probe', () => {
    expect(BLEND_CHIP_WEIGHT).toBe(0.7)
    expect(CHIP_RISE_TAU_S).toBe(10)
    expect(CHIP_FALL_TAU_S).toBe(45)
  })
})

describe('selectThermalReading', () => {
  it('takes the hottest chip sensor, averages the palm rest and ignores the battery', () => {
    const reading = selectThermalReading(M2_PRO_SENSORS)

    expect(reading.chipC).toBe(81.4)
    expect(reading.palmrestC).toBe(33)
    expect(reading.palmrestAvailable).toBe(true)
    expect(reading.blendC).toBeCloseTo(0.7 * 81.4 + 0.3 * 33, 6)
  })

  it('falls back to the chip alone when the Mac exposes no palm-rest sensor', () => {
    const reading = selectThermalReading({ ...M2_PRO_SENSORS, palmrest: [] })

    expect(reading).toEqual({
      chipC: 81.4,
      palmrestC: null,
      blendC: 81.4,
      palmrestAvailable: false
    })
  })

  it('reports no temperatures when no sensors are recognised', () => {
    expect(selectThermalReading({ chip: [], palmrest: [], battery: [] })).toEqual({
      chipC: null,
      palmrestC: null,
      blendC: null,
      palmrestAvailable: false
    })
  })
})

describe('blendTemperature', () => {
  it('starts at the weighted mix when there is no previous blend', () => {
    expect(blendTemperature(90, 30, null, 2)).toBeCloseTo(0.7 * 90 + 0.3 * 30, 6)
    expect(blendTemperature(90, null, null, 2)).toBe(90)
  })

  it('leads with the chip on the way up using the fast rise constant', () => {
    const previous = 0.7 * 50 + 0.3 * 30
    const target = 0.7 * 90 + 0.3 * 30

    const next = blendTemperature(90, 30, previous, 10)

    expect(next).toBeCloseTo(approach(previous, target, 10, 10), 6)
    // Palm rest did not move, yet the blend already covered ~63% of the chip jump.
    expect(next - previous).toBeGreaterThan(0.6 * (target - previous))
  })

  it('relaxes slower than it rises, using the fall constant', () => {
    const low = 0.7 * 50 + 0.3 * 30
    const high = 0.7 * 90 + 0.3 * 30

    const fell = blendTemperature(50, 30, high, 10)
    const rose = blendTemperature(90, 30, low, 10)

    expect(fell).toBeCloseTo(approach(high, low, 10, 45), 6)
    expect(high - fell).toBeLessThan(rose - low)
  })

  it('settles on the palm rest when the chip has cooled down', () => {
    const hot = 0.7 * 95 + 0.3 * 40

    const warmPalmrest = runFor(hot, 60, 40, 600)
    const coolPalmrest = runFor(hot, 60, 30, 600)

    expect(warmPalmrest).toBeCloseTo(0.7 * 60 + 0.3 * 40, 1)
    expect(coolPalmrest).toBeCloseTo(0.7 * 60 + 0.3 * 30, 1)
    expect(warmPalmrest).toBeGreaterThan(coolPalmrest)
  })

  it('smooths the chip alone when there is no palm rest', () => {
    expect(blendTemperature(90, null, 50, 10)).toBeCloseTo(approach(50, 90, 10, 10), 6)
    expect(blendTemperature(50, null, 90, 10)).toBeCloseTo(approach(90, 50, 10, 45), 6)
  })

  it('keeps the previous blend when no time has passed', () => {
    expect(blendTemperature(110, 30, 60, 0)).toBe(60)
  })
})

describe('readingFor', () => {
  const reading: ThermalReading = {
    chipC: 80,
    palmrestC: 33,
    blendC: 65.9,
    palmrestAvailable: true
  }

  it('returns the line the curve is drawn against', () => {
    expect(readingFor('chip', reading)).toBe(80)
    expect(readingFor('palmrest', reading)).toBe(33)
    expect(readingFor('blend', reading)).toBe(65.9)
  })

  it('returns null for the palm rest on a Mac without that sensor', () => {
    const chipOnly: ThermalReading = {
      chipC: 80,
      palmrestC: null,
      blendC: 80,
      palmrestAvailable: false
    }

    expect(readingFor('palmrest', chipOnly)).toBeNull()
    expect(readingFor('blend', chipOnly)).toBe(80)
  })
})
