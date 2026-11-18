import type {
  FanControlHelperSensorsOutput,
  FanSensorValue,
  TemperatureSource,
  ThermalReading
} from '../../shared/fan-control-contract'

// Measured by the T2 probe on an M2 Pro: palm rest lags the chip by tens of minutes.
export const BLEND_CHIP_WEIGHT = 0.7
export const CHIP_RISE_TAU_S = 10
export const CHIP_FALL_TAU_S = 45

function hottest(values: FanSensorValue[]): number | null {
  return values.length === 0 ? null : Math.max(...values.map((value) => value.c))
}

function mean(values: FanSensorValue[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value.c, 0) / values.length
}

function blendTarget(chipC: number, palmrestC: number | null): number {
  return palmrestC === null
    ? chipC
    : BLEND_CHIP_WEIGHT * chipC + (1 - BLEND_CHIP_WEIGHT) * palmrestC
}

/** Instant reading; the service smooths blendC over time with blendTemperature. */
export function selectThermalReading(sensors: FanControlHelperSensorsOutput): ThermalReading {
  const chipC = hottest(sensors.chip)
  if (chipC === null) {
    return { chipC: null, palmrestC: null, blendC: null, palmrestAvailable: false }
  }
  const palmrestC = mean(sensors.palmrest)
  return {
    chipC,
    palmrestC,
    blendC: blendTarget(chipC, palmrestC),
    palmrestAvailable: palmrestC !== null
  }
}

/** Asymmetric EMA: rises fast with the chip, relaxes slowly so the palm rest decides when to calm down. */
export function blendTemperature(
  chipC: number,
  palmrestC: number | null,
  previousBlend: number | null,
  elapsedS: number
): number {
  const target = blendTarget(chipC, palmrestC)
  if (previousBlend === null) {
    return target
  }
  const tauS = target > previousBlend ? CHIP_RISE_TAU_S : CHIP_FALL_TAU_S
  return previousBlend + (target - previousBlend) * (1 - Math.exp(-elapsedS / tauS))
}

export function readingFor(source: TemperatureSource, reading: ThermalReading): number | null {
  switch (source) {
    case 'chip':
      return reading.chipC
    case 'palmrest':
      return reading.palmrestC
    case 'blend':
      return reading.blendC
  }
}
