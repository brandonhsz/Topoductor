import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import type {
  FanCurve,
  FanCurvePoint,
  FanReading,
  ThermalReading,
  ThermalSample
} from '../../../../shared/fan-control-contract'
import { FanCurveEditor } from './FanCurveEditor'
import { FanThermalChart } from './FanThermalChart'

const T0 = 1_700_000_000_000
const SAMPLES = 60
const STEP_MS = 5_000

const TWO_FANS: FanReading[] = [
  { index: 0, rpm: 3900, minRpm: 2317, maxRpm: 6800 },
  { index: 1, rpm: 3700, minRpm: 2317, maxRpm: 6800 }
]

const CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 60, percent: 0 },
    { tempC: 70, percent: 35 },
    { tempC: 80, percent: 70 },
    { tempC: 88, percent: 100 }
  ]
}

const LEARNED: FanCurvePoint[] = [
  { tempC: 55, percent: 10 },
  { tempC: 68, percent: 45 },
  { tempC: 78, percent: 85 },
  { tempC: 86, percent: 100 }
]

/** A build spike around the middle of a five-minute window; the palm rest lags the chip. */
function history(fanCount: number, palmrest: boolean): ThermalSample[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const load = Math.exp(-(((i - 30) / 10) ** 2))
    const chipC = 52 + 40 * load + 3 * Math.sin(i / 2)
    const palmrestC = palmrest ? 31.5 + 2 * Math.exp(-(((i - 38) / 14) ** 2)) : null
    const blendC = palmrestC === null ? chipC : 0.7 * chipC + 0.3 * palmrestC
    const fanRpm = Array.from({ length: fanCount }, (_, f) =>
      Math.round(2317 + (4200 - f * 300) * Math.exp(-(((i - 33) / 11) ** 2)))
    )
    return {
      at: T0 + i * STEP_MS,
      chipC,
      palmrestC,
      blendC,
      palmrestAvailable: palmrest,
      fanRpm
    }
  })
}

function latestReading(samples: ThermalSample[]): ThermalReading {
  const { chipC, palmrestC, blendC, palmrestAvailable } = samples.at(-1)!
  return { chipC, palmrestC, blendC, palmrestAvailable }
}

function Panel({
  fans,
  palmrest,
  learnedPoints,
  initialCurve = CURVE
}: {
  fans: FanReading[]
  palmrest: boolean
  learnedPoints?: FanCurvePoint[]
  initialCurve?: FanCurve
}): React.JSX.Element {
  const samples = history(fans.length, palmrest)
  const [curve, setCurve] = useState(initialCurve)
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-popover p-3 text-popover-foreground">
      <FanThermalChart history={samples} fans={fans} palmrestAvailable={palmrest} />
      {fans.length > 0 ? (
        <FanCurveEditor
          curve={curve}
          thermal={latestReading(samples)}
          learnedPoints={learnedPoints}
          onChange={setCurve}
        />
      ) : null}
    </div>
  )
}

export const twoFans = defineFixture({
  width: 340,
  render: () => <Panel fans={TWO_FANS} palmrest learnedPoints={LEARNED} />
})

export const oneFan = defineFixture({
  width: 340,
  render: () => <Panel fans={[TWO_FANS[0]]} palmrest />
})

export const noPalmrest = defineFixture({
  width: 340,
  render: () => (
    <Panel fans={TWO_FANS} palmrest={false} initialCurve={{ ...CURVE, source: 'chip' }} />
  )
})

export const fanless = defineFixture({
  width: 340,
  render: () => <Panel fans={[]} palmrest />
})

export const waiting = defineFixture({
  width: 340,
  render: () => <FanThermalChart history={[]} fans={TWO_FANS} palmrestAvailable />
})

export const keyboardFocus = defineFixture({
  width: 340,
  render: () => <Panel fans={TWO_FANS} palmrest />,
  interact: (frame) => {
    frame.querySelectorAll<SVGGElement>('[role="slider"]')[1]?.focus()
  }
})
