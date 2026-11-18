import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { uiNumberFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  FanReading,
  TemperatureSource,
  ThermalReading,
  ThermalSample
} from '../../../../shared/fan-control-contract'

// Intl formatter caches key on option identity, so these must be module constants.
const TEMP_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
const RPM_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }

const VIEW_W = 320
const VIEW_H = 138
const PAD = { left: 30, right: 34, top: 20, bottom: 18 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom

/** Stroke class per temperature line; the curve editor reuses it for its "now" marker. */
export const TEMPERATURE_SERIES_STROKE: Record<TemperatureSource, string> = {
  palmrest: 'stroke-amber-500',
  chip: 'stroke-rose-500',
  blend: 'stroke-foreground'
}

const FAN_SERIES_STYLE = [
  { stroke: 'stroke-chart-2', dash: undefined },
  { stroke: 'stroke-chart-3', dash: '3 2' }
] as const

function fanStyle(position: number): (typeof FAN_SERIES_STYLE)[number] {
  return FAN_SERIES_STYLE[position % FAN_SERIES_STYLE.length]
}

function LegendSwatch({
  stroke,
  dash,
  strokeWidth = 2
}: {
  stroke: string
  dash?: string
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg width={14} height={4} viewBox="0 0 14 4" aria-hidden className="shrink-0">
      <line
        x1={1}
        x2={13}
        y1={2}
        y2={2}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinecap="round"
        className={stroke}
      />
    </svg>
  )
}

const WITH_PALMREST: readonly TemperatureSource[] = ['palmrest', 'chip', 'blend']
// Without a palm rest the blend is the chip, so only the chip is shown.
const CHIP_ONLY: readonly TemperatureSource[] = ['chip']

/** The source a curve really follows: blend and palm rest fall back to the chip without a palm-rest sensor. */
export function effectiveTemperatureSource(
  source: TemperatureSource,
  palmrestAvailable: boolean
): TemperatureSource {
  return palmrestAvailable ? source : 'chip'
}

export function temperatureSourceLabel(source: TemperatureSource, t: Translate): string {
  switch (source) {
    case 'palmrest':
      return t('auto.components.status.bar.FanThermalChart.palmrest', 'Palm rest')
    case 'chip':
      return t('auto.components.status.bar.FanThermalChart.chip', 'Chip')
    case 'blend':
      return t('auto.components.status.bar.FanThermalChart.blend', 'Blend')
  }
}

export function readingForSource(
  source: TemperatureSource,
  reading: ThermalReading
): number | null {
  switch (source) {
    case 'palmrest':
      return reading.palmrestC
    case 'chip':
      return reading.chipC
    case 'blend':
      return reading.blendC
  }
}

type ScaleY = (value: number) => number

/** Breaks the line at missing readings instead of bridging them. */
function seriesPath(values: (number | null)[], scaleY: ScaleY): string {
  const stepX = values.length > 1 ? PLOT_W / (values.length - 1) : 0
  let path = ''
  let penDown = false
  values.forEach((value, i) => {
    if (value === null) {
      penDown = false
      return
    }
    const x = (PAD.left + i * stepX).toFixed(1)
    const y = scaleY(value).toFixed(1)
    path += `${penDown ? 'L' : 'M'}${x} ${y} `
    penDown = true
  })
  return path.trim()
}

function temperatureDomain(values: number[]): [number, number] {
  if (values.length === 0) {
    return [30, 100]
  }
  const lo = Math.floor((Math.min(...values) - 2) / 10) * 10
  const hi = Math.ceil((Math.max(...values) + 2) / 10) * 10
  return [lo, Math.max(hi, lo + 20)]
}

function linearY(lo: number, hi: number): ScaleY {
  return (value) => PAD.top + PLOT_H - ((value - lo) / (hi - lo || 1)) * PLOT_H
}

export function FanThermalChart({
  history,
  fans,
  palmrestAvailable
}: {
  history: ThermalSample[]
  fans: FanReading[]
  palmrestAvailable: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const tempFormat = uiNumberFormat(TEMP_FORMAT)
  const rpmFormat = uiNumberFormat(RPM_FORMAT)
  const sources = palmrestAvailable ? WITH_PALMREST : CHIP_ONLY

  const chart = useMemo(() => {
    const temps = history.flatMap((s) =>
      sources.map((source) => readingForSource(source, s)).filter((v) => v !== null)
    )
    const [tempLo, tempHi] = temperatureDomain(temps)
    const tempY = linearY(tempLo, tempHi)
    // Readings can overshoot the rated maximum a little; the axis stays at the rated value.
    const rpmHi = Math.max(1, ...fans.map((f) => f.maxRpm))
    const rpmScale = linearY(0, rpmHi)
    const rpmY: ScaleY = (value) => rpmScale(Math.min(value, rpmHi))
    return {
      tempLo,
      tempHi,
      rpmHi,
      temperatures: sources.map((source) => ({
        source,
        d: seriesPath(
          history.map((s) => readingForSource(source, s)),
          tempY
        )
      })),
      fans: fans.map((fan) => ({
        index: fan.index,
        d: seriesPath(
          history.map((s) => s.fanRpm[fan.index] ?? null),
          rpmY
        )
      }))
    }
  }, [history, fans, sources])

  const latest = history.at(-1)
  const spanSeconds =
    history.length > 1 ? Math.round((history.at(-1)!.at - history[0].at) / 1000) : 0
  const spanText =
    spanSeconds < 60
      ? t('auto.components.status.bar.FanThermalChart.seconds', '{{seconds}} s', {
          seconds: spanSeconds
        })
      : t('auto.components.status.bar.FanThermalChart.minutes', '{{minutes}} min', {
          minutes: Math.round(spanSeconds / 60)
        })
  const title = t(
    'auto.components.status.bar.FanThermalChart.ariaLabel',
    'Temperature and fan speed over the last {{span}}',
    { span: spanText }
  )
  const degrees = (value: number): string =>
    t('auto.components.status.bar.FanThermalChart.degrees', '{{value}} °C', {
      value: tempFormat.format(value)
    })
  const tempTicks = [chart.tempHi, (chart.tempLo + chart.tempHi) / 2, chart.tempLo]
  const tempY = linearY(chart.tempLo, chart.tempHi)

  return (
    <div className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full overflow-visible"
      >
        {tempTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={tempY(tick)}
              y2={tempY(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 4}
              y={tempY(tick)}
              dominantBaseline="middle"
              textAnchor="end"
              className="fill-muted-foreground text-3xs tabular-nums"
            >
              {degrees(tick)}
            </text>
          </g>
        ))}
        {chart.fans.length > 0 ? (
          <g className="fill-muted-foreground text-3xs tabular-nums">
            <text x={PAD.left + PLOT_W + 4} y={PAD.top - 13} dominantBaseline="middle">
              {t('auto.components.status.bar.FanThermalChart.rpmAxis', 'RPM')}
            </text>
            <text x={PAD.left + PLOT_W + 4} y={tempY(chart.tempHi)} dominantBaseline="middle">
              {rpmFormat.format(chart.rpmHi)}
            </text>
            <text x={PAD.left + PLOT_W + 4} y={tempY(chart.tempLo)} dominantBaseline="middle">
              {rpmFormat.format(0)}
            </text>
          </g>
        ) : null}
        {spanSeconds > 0 ? (
          <>
            <text
              x={PAD.left}
              y={VIEW_H - 4}
              className="fill-muted-foreground text-3xs tabular-nums"
            >
              {t('auto.components.status.bar.FanThermalChart.spanAgo', '{{span}} ago', {
                span: spanText
              })}
            </text>
            <text
              x={PAD.left + PLOT_W}
              y={VIEW_H - 4}
              textAnchor="end"
              className="fill-muted-foreground text-3xs"
            >
              {t('auto.components.status.bar.FanThermalChart.now', 'Now')}
            </text>
          </>
        ) : (
          <text
            x={PAD.left + PLOT_W / 2}
            y={PAD.top + PLOT_H / 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-2xs"
          >
            {t('auto.components.status.bar.FanThermalChart.waiting', 'Waiting for readings')}
          </text>
        )}
        {chart.fans.map((fan, i) => (
          <path
            key={fan.index}
            data-series={`fan-${fan.index}`}
            d={fan.d}
            fill="none"
            strokeWidth={1}
            strokeDasharray={fanStyle(i).dash}
            strokeLinejoin="round"
            className={cn(fanStyle(i).stroke, 'opacity-80')}
          />
        ))}
        {chart.temperatures.map((line) => (
          <path
            key={line.source}
            data-series={line.source}
            d={line.d}
            fill="none"
            strokeWidth={line.source === 'blend' ? 2 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={TEMPERATURE_SERIES_STROKE[line.source]}
          />
        ))}
      </svg>
      <div className="flex flex-col gap-1 text-2xs text-muted-foreground">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {sources.map((source) => {
            const value = latest ? readingForSource(source, latest) : null
            return (
              <li key={source} className="inline-flex items-center gap-1.5">
                <LegendSwatch stroke={TEMPERATURE_SERIES_STROKE[source]} />
                <span>{temperatureSourceLabel(source, t)}</span>
                {value !== null ? (
                  <span className="tabular-nums text-foreground">{degrees(value)}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
        {fans.length > 0 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {fans.map((fan, i) => {
              const rpm = latest?.fanRpm[fan.index]
              return (
                <li key={fan.index} className="inline-flex items-center gap-1.5">
                  <LegendSwatch
                    stroke={fanStyle(i).stroke}
                    dash={fanStyle(i).dash}
                    strokeWidth={1.5}
                  />
                  <span>
                    {t('auto.components.status.bar.FanThermalChart.fanName', 'Fan {{n}}', {
                      n: fan.index + 1
                    })}
                  </span>
                  {rpm !== undefined ? (
                    <span className="tabular-nums text-foreground">
                      {t('auto.components.status.bar.FanThermalChart.rpm', '{{rpm}} RPM', {
                        rpm: rpmFormat.format(rpm)
                      })}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      {!palmrestAvailable ? (
        <p role="note" className="text-2xs text-muted-foreground">
          {t(
            'auto.components.status.bar.FanThermalChart.chipOnly',
            'This Mac has no palm-rest sensor Topo recognizes, so it uses the chip temperature only.'
          )}
        </p>
      ) : null}
    </div>
  )
}
