import type { FanReading, ThermalReading, ThermalSample } from '../../shared/fan-control-contract'
import { blendTemperature } from './thermal-blend'

export const THERMAL_HISTORY_WINDOW_MS = 10 * 60_000

/** Smooths the blend line between readings and keeps the last 10 minutes for the live chart. */
export class FanThermalHistory {
  private samples: ThermalSample[] = []
  private lastBlend: { c: number; at: number } | null = null

  record(instant: ThermalReading, fans: FanReading[], now: number): ThermalReading {
    const blendC =
      instant.chipC === null
        ? null
        : blendTemperature(
            instant.chipC,
            instant.palmrestC,
            this.lastBlend?.c ?? null,
            this.lastBlend ? (now - this.lastBlend.at) / 1000 : 0
          )
    this.lastBlend = blendC === null ? null : { c: blendC, at: now }
    const reading: ThermalReading = { ...instant, blendC }
    this.samples.push({ ...reading, at: now, fanRpm: fans.map((fan) => fan.rpm) })
    this.samples = this.samples.filter((sample) => sample.at >= now - THERMAL_HISTORY_WINDOW_MS)
    return reading
  }

  list(): ThermalSample[] {
    return [...this.samples]
  }
}
