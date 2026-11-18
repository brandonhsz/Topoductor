import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { uiNumberFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate } from '@/i18n/use-translate'
import {
  FAN_CURVE_LIMITS,
  TEMPERATURE_SOURCES,
  type FanCurve,
  type FanCurvePoint,
  type TemperatureSource,
  type ThermalReading
} from '../../../../shared/fan-control-contract'
import {
  effectiveTemperatureSource,
  readingForSource,
  TEMPERATURE_SERIES_STROKE,
  temperatureSourceLabel
} from './FanThermalChart'

// Intl formatter caches key on option identity, so this must be a module constant.
const TEMP_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }

const VIEW_W = 320
const VIEW_H = 168
const PAD = { left: 30, right: 12, top: 16, bottom: 20 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom
const TEMP_SPAN = FAN_CURVE_LIMITS.maxTempC - FAN_CURVE_LIMITS.minTempC
const PERCENT_SPAN = FAN_CURVE_LIMITS.maxPercent - FAN_CURVE_LIMITS.minPercent
const TEMP_TICKS = [20, 40, 60, 80, 100]
const KEY_STEP = 1
const KEY_STEP_LARGE = 5

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1]
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function x(tempC: number): number {
  return (
    PAD.left +
    ((clamp(tempC, FAN_CURVE_LIMITS.minTempC, FAN_CURVE_LIMITS.maxTempC) -
      FAN_CURVE_LIMITS.minTempC) /
      TEMP_SPAN) *
      PLOT_W
  )
}

function y(percent: number): number {
  return PAD.top + PLOT_H - ((percent - FAN_CURVE_LIMITS.minPercent) / PERCENT_SPAN) * PLOT_H
}

/** Keeps the curve valid: strictly hotter than the previous point, never slower than it, within limits. */
function clampPoint(points: FanCurvePoint[], index: number, wanted: FanCurvePoint): FanCurvePoint {
  const prev = points[index - 1]
  const next = points[index + 1]
  return {
    tempC: clamp(
      Math.round(wanted.tempC),
      prev ? prev.tempC + 1 : FAN_CURVE_LIMITS.minTempC,
      next ? next.tempC - 1 : FAN_CURVE_LIMITS.maxTempC
    ),
    percent: clamp(
      Math.round(wanted.percent),
      prev ? prev.percent : FAN_CURVE_LIMITS.minPercent,
      next ? next.percent : FAN_CURVE_LIMITS.maxPercent
    )
  }
}

function polyline(points: FanCurvePoint[]): string {
  return points.map((p) => `${x(p.tempC).toFixed(1)},${y(p.percent).toFixed(1)}`).join(' ')
}

/** Fan percent the curve asks for at tempC; null below the first point, where macOS decides. */
function percentAt(points: FanCurvePoint[], tempC: number): number | null {
  if (points.length === 0 || tempC < points[0].tempC) {
    return null
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (tempC <= b.tempC) {
      return a.percent + ((tempC - a.tempC) / (b.tempC - a.tempC)) * (b.percent - a.percent)
    }
  }
  return points.at(-1)!.percent
}

export function FanCurveEditor({
  curve,
  thermal,
  learnedPoints,
  disabled = false,
  onChange
}: {
  curve: FanCurve
  thermal: ThermalReading
  learnedPoints?: FanCurvePoint[]
  disabled?: boolean
  onChange: (curve: FanCurve) => void
}): React.JSX.Element {
  const t = useTranslate()
  const tempFormat = uiNumberFormat(TEMP_FORMAT)
  const plotRef = useRef<SVGRectElement>(null)
  const draggingRef = useRef<number | null>(null)
  // A drag previews locally and commits once on release, so main is not re-saved per pointermove.
  const dragDraftRef = useRef<FanCurve | null>(null)
  const [dragDraft, setDragDraft] = useState<FanCurve | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const sourceLabelId = useId()

  const degrees = (value: number): string =>
    t('auto.components.status.bar.FanCurveEditor.degrees', '{{value}} °C', {
      value: tempFormat.format(value)
    })

  const movedCurve = (base: FanCurve, index: number, wanted: FanCurvePoint): FanCurve | null => {
    const points = base.points.slice()
    const moved = clampPoint(points, index, wanted)
    if (moved.tempC === points[index].tempC && moved.percent === points[index].percent) {
      return null
    }
    points[index] = moved
    return { ...base, points }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const index = draggingRef.current
    const plot = plotRef.current
    if (index === null || !plot) {
      return
    }
    const rect = plot.getBoundingClientRect()
    const fx = (event.clientX - rect.left) / (rect.width || 1)
    const fy = (event.clientY - rect.top) / (rect.height || 1)
    const next = movedCurve(dragDraftRef.current ?? curve, index, {
      tempC: FAN_CURVE_LIMITS.minTempC + fx * TEMP_SPAN,
      percent: FAN_CURVE_LIMITS.minPercent + (1 - fy) * PERCENT_SPAN
    })
    if (next) {
      dragDraftRef.current = next
      setDragDraft(next)
    }
  }

  const endDrag = (commit: boolean): void => {
    const draft = dragDraftRef.current
    draggingRef.current = null
    dragDraftRef.current = null
    setDragDraft(null)
    if (commit && draft) {
      onChange(draft)
    }
  }

  const shown = dragDraft ?? curve
  const shownSource = effectiveTemperatureSource(shown.source, thermal.palmrestAvailable)
  const nowC = readingForSource(shownSource, thermal)
  const nowPercent = nowC === null ? null : percentAt(shown.points, nowC)
  const first = shown.points[0]
  const last = shown.points.at(-1)
  const active = activeIndex === null ? undefined : shown.points[activeIndex]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span
          id={sourceLabelId}
          className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground"
        >
          {t('auto.components.status.bar.FanCurveEditor.sourceLabel', 'Curve follows')}
        </span>
        <ToggleGroup
          type="single"
          size="xs"
          variant="segmented-card"
          aria-labelledby={sourceLabelId}
          className="w-auto grid-cols-3"
          value={shownSource}
          disabled={disabled}
          onValueChange={(value) => {
            const source = TEMPERATURE_SOURCES.find((s) => s === value)
            if (source && source !== curve.source) {
              onChange({ ...curve, source })
            }
          }}
        >
          {TEMPERATURE_SOURCES.map((source: TemperatureSource) => (
            <ToggleGroupItem
              key={source}
              value={source}
              disabled={disabled || (source !== 'chip' && !thermal.palmrestAvailable)}
            >
              {temperatureSourceLabel(source, t)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={cn('block h-auto w-full touch-none select-none', disabled && 'opacity-60')}
        onPointerMove={handlePointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        <rect
          ref={plotRef}
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          className="fill-transparent stroke-border"
        />
        {[50].map((percent) => (
          <line
            key={percent}
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={y(percent)}
            y2={y(percent)}
            className="stroke-border"
          />
        ))}
        <text
          x={PAD.left - 4}
          y={y(FAN_CURVE_LIMITS.maxPercent)}
          dominantBaseline="middle"
          textAnchor="end"
          className="fill-muted-foreground text-3xs"
        >
          {t('auto.components.status.bar.FanCurveEditor.maxSpeed', 'Max')}
        </text>
        <text
          x={PAD.left - 4}
          y={y(FAN_CURVE_LIMITS.minPercent)}
          dominantBaseline="middle"
          textAnchor="end"
          className="fill-muted-foreground text-3xs"
        >
          {t('auto.components.status.bar.FanCurveEditor.minSpeed', 'Min')}
        </text>
        {TEMP_TICKS.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={VIEW_H - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-3xs tabular-nums"
          >
            {degrees(tick)}
          </text>
        ))}
        {first && x(first.tempC) - PAD.left > 44 ? (
          <text
            x={PAD.left + 4}
            y={y(FAN_CURVE_LIMITS.minPercent) - 6}
            className="fill-muted-foreground text-3xs"
          >
            {t('auto.components.status.bar.FanCurveEditor.macosZone', 'macOS')}
          </text>
        ) : null}
        {first && last ? (
          <>
            <polygon
              points={`${x(first.tempC)},${y(FAN_CURVE_LIMITS.minPercent)} ${polyline(shown.points)} ${PAD.left + PLOT_W},${y(last.percent)} ${PAD.left + PLOT_W},${y(FAN_CURVE_LIMITS.minPercent)}`}
              className="fill-chart-2/10"
            />
            <line
              x1={x(last.tempC)}
              x2={PAD.left + PLOT_W}
              y1={y(last.percent)}
              y2={y(last.percent)}
              strokeWidth={2}
              className="stroke-chart-2"
            />
          </>
        ) : null}
        {learnedPoints && learnedPoints.length > 0 ? (
          <polyline
            data-series="learned"
            points={polyline(learnedPoints)}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            className="stroke-muted-foreground"
          />
        ) : null}
        <polyline
          data-series="curve"
          points={polyline(shown.points)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-chart-2"
        />
        {nowC !== null ? (
          <g
            role="img"
            aria-label={t('auto.components.status.bar.FanCurveEditor.nowMarker', 'Now: {{temp}}', {
              temp: degrees(Math.round(nowC))
            })}
            className={TEMPERATURE_SERIES_STROKE[shownSource]}
          >
            <line
              x1={x(nowC)}
              x2={x(nowC)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <text
              x={x(nowC)}
              y={PAD.top - 4}
              textAnchor="middle"
              stroke="none"
              className="fill-foreground text-3xs tabular-nums"
            >
              {degrees(Math.round(nowC))}
            </text>
            {nowPercent !== null ? (
              <circle
                cx={x(nowC)}
                cy={y(nowPercent)}
                r={3}
                strokeWidth={2}
                className="fill-background"
              />
            ) : null}
          </g>
        ) : null}
        {shown.points.map((point, index) => (
          <g
            key={index}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={t('auto.components.status.bar.FanCurveEditor.point', 'Point {{n}}', {
              n: index + 1
            })}
            aria-valuemin={FAN_CURVE_LIMITS.minPercent}
            aria-valuemax={FAN_CURVE_LIMITS.maxPercent}
            aria-valuenow={point.percent}
            aria-valuetext={t(
              'auto.components.status.bar.FanCurveEditor.pointValue',
              '{{temp}}, {{percent}}% speed',
              { temp: degrees(point.tempC), percent: point.percent }
            )}
            aria-disabled={disabled || undefined}
            className={cn('group outline-none', disabled ? 'cursor-default' : 'cursor-grab')}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) {
                return
              }
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              draggingRef.current = index
            }}
            onKeyDown={(event) => {
              const delta = ARROW_DELTAS[event.key]
              if (disabled || !delta) {
                return
              }
              event.preventDefault()
              const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
              const next = movedCurve(curve, index, {
                tempC: point.tempC + delta[0] * step,
                percent: point.percent + delta[1] * step
              })
              if (next) {
                onChange(next)
              }
            }}
          >
            <circle cx={x(point.tempC)} cy={y(point.percent)} r={11} className="fill-transparent" />
            <circle
              cx={x(point.tempC)}
              cy={y(point.percent)}
              r={8}
              fill="none"
              className="stroke-ring opacity-0 group-focus-visible:opacity-100"
              strokeWidth={2}
            />
            <circle
              cx={x(point.tempC)}
              cy={y(point.percent)}
              r={4.5}
              strokeWidth={2}
              className="fill-background stroke-chart-2"
            />
          </g>
        ))}
      </svg>
      <p className="min-h-[2lh] text-2xs text-muted-foreground tabular-nums" aria-live="polite">
        {active
          ? t(
              'auto.components.status.bar.FanCurveEditor.activePoint',
              'Point {{n}}: {{temp}} → {{percent}}% speed',
              { n: (activeIndex ?? 0) + 1, temp: degrees(active.tempC), percent: active.percent }
            )
          : t(
              'auto.components.status.bar.FanCurveEditor.hint',
              'Below the first point macOS decides. Drag points or use the arrow keys.'
            )}
      </p>
    </div>
  )
}
