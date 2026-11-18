import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  type FanControlError,
  type FanCurve,
  type ThermalSample
} from '../../../../shared/fan-control-contract'
import { FanControlPanelView, type SupportedFanControlStatus } from './FanControlStatusSegment'

const T0 = 1_700_000_000_000
const SAMPLES = 60
const STEP_MS = 5_000

const CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 58, percent: 0 },
    { tempC: 68, percent: 35 },
    { tempC: 78, percent: 70 },
    { tempC: 88, percent: 100 }
  ]
}

const LEARNED = [
  { tempC: 55, percent: 10 },
  { tempC: 66, percent: 45 },
  { tempC: 76, percent: 85 },
  { tempC: 86, percent: 100 }
]

/** A build spike in the middle of five minutes; the palm rest lags the chip. */
function history(fanCount: number, palmrest: boolean): ThermalSample[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const load = Math.exp(-(((i - 30) / 10) ** 2))
    const chipC = 52 + 40 * load + 3 * Math.sin(i / 2)
    const palmrestC = palmrest ? 31.5 + 2 * Math.exp(-(((i - 38) / 14) ** 2)) : null
    const blendC = palmrestC === null ? chipC : 0.7 * chipC + 0.3 * palmrestC
    const fanRpm = Array.from({ length: fanCount }, (_, f) =>
      Math.round(2317 + (4200 - f * 300) * Math.exp(-(((i - 33) / 11) ** 2)))
    )
    return { at: T0 + i * STEP_MS, chipC, palmrestC, blendC, palmrestAvailable: palmrest, fanRpm }
  })
}

function statusFor(samples: ThermalSample[]): SupportedFanControlStatus {
  const last = samples.at(-1)!
  return {
    supported: true,
    ...NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
    thermal: {
      chipC: last.chipC,
      palmrestC: last.palmrestC,
      blendC: last.blendC,
      palmrestAvailable: last.palmrestAvailable
    },
    curve: CURVE,
    smart: { learned: LEARNED, answers: 6, updatedAt: T0 },
    mode: 'auto',
    pending: false,
    fans: last.fanRpm.map((rpm, index) => ({ index, rpm, minRpm: 2317, maxRpm: 6800 })),
    appliedRpm: last.fanRpm.map(() => null)
  }
}

const TWO_FAN_HISTORY = history(2, true)
const AUTO = statusFor(TWO_FAN_HISTORY)

function Panel({
  status,
  samples = TWO_FAN_HISTORY,
  notice = null,
  open = true
}: {
  status: SupportedFanControlStatus
  samples?: ThermalSample[]
  notice?: FanControlError | null
  open?: boolean
}): React.JSX.Element {
  const [curve, setCurve] = useState(status.curve)
  return (
    <div className="flex h-[860px] items-end justify-end bg-background p-3">
      <FanControlPanelView
        status={{ ...status, curve }}
        history={samples}
        iconOnly={false}
        notice={notice}
        answering={false}
        defaultOpen={open}
        onSelectMode={() => {}}
        onCurveChange={setCurve}
        onManualRpm={() => {}}
        onDismissPaused={() => {}}
        onAnswerFeedback={() => {}}
      />
    </div>
  )
}

const WIDTH = 440

export const automatic = defineFixture({ width: WIDTH, render: () => <Panel status={AUTO} /> })

export const curve = defineFixture({
  width: WIDTH,
  render: () => <Panel status={{ ...AUTO, mode: 'curve', session: 'active' }} />
})

export const smart = defineFixture({
  width: WIDTH,
  render: () => (
    <Panel
      status={{
        ...AUTO,
        mode: 'smart',
        session: 'active',
        feedbackPrompt: { id: 'p1', askedAt: T0, tempC: 62 }
      }}
    />
  )
})

export const maxSpeed = defineFixture({
  width: WIDTH,
  render: () => (
    <Panel
      status={{
        ...AUTO,
        mode: 'max',
        session: 'active',
        fans: AUTO.fans.map((fan) => ({ ...fan, rpm: 6790 }))
      }}
    />
  )
})

export const manual = defineFixture({
  width: WIDTH,
  render: () => (
    <Panel status={{ ...AUTO, mode: 'manual', session: 'active', manualRpm: { 0: 4200 } }} />
  )
})

export const pending = defineFixture({
  width: WIDTH,
  render: () => <Panel status={{ ...AUTO, mode: 'curve', pending: true }} />
})

export const pausedMode = defineFixture({
  width: WIDTH,
  render: () => <Panel status={{ ...AUTO, pausedMode: 'smart' }} />
})

export const authCancelled = defineFixture({
  width: WIDTH,
  render: () => <Panel status={AUTO} notice={{ kind: 'auth-cancelled' }} />
})

export const holdExited = defineFixture({
  width: WIDTH,
  render: () => <Panel status={{ ...AUTO, lastError: { kind: 'hold-exited', detail: 'exit 1' } }} />
})

const ONE_FAN_NO_PALMREST = history(1, false)

export const oneFanNoPalmrest = defineFixture({
  width: WIDTH,
  render: () => {
    const status = statusFor(ONE_FAN_NO_PALMREST)
    return (
      <Panel
        status={{ ...status, mode: 'curve', curve: { ...CURVE, source: 'chip' } }}
        samples={ONE_FAN_NO_PALMREST}
      />
    )
  }
})

const FANLESS_HISTORY = history(0, true)

export const fanless = defineFixture({
  width: WIDTH,
  render: () => (
    <Panel
      status={{ ...statusFor(FANLESS_HISTORY), controllable: false }}
      samples={FANLESS_HISTORY}
    />
  )
})

export const feedbackQuestion = defineFixture({
  width: WIDTH,
  render: () => (
    <Panel
      open={false}
      status={{
        ...AUTO,
        mode: 'smart',
        feedbackPrompt: { id: 'p1', askedAt: T0, tempC: 62 }
      }}
    />
  )
})
