import { useState } from 'react'
import { Gauge, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Slider } from '@/components/ui/slider'
import { uiNumberFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  FanControlActiveMode,
  FanControlError,
  FanControlMode,
  FanCurve,
  FanReading,
  SupportedFanControlStatus,
  ThermalSample
} from '../../../../shared/fan-control-contract'
import { FanCurveEditor } from './FanCurveEditor'
import { FanThermalChart } from './FanThermalChart'

// Intl formatter caches key on option identity, so this must be a module constant.
const RPM_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }

type SelectableMode = 'auto' | 'curve' | 'smart'
const SELECTABLE_MODES: readonly SelectableMode[] = ['auto', 'curve', 'smart']

function isSelectableMode(value: string): value is SelectableMode {
  return value === 'auto' || value === 'curve' || value === 'smart'
}

export function fanModeLabel(mode: FanControlMode, t: Translate): string {
  switch (mode) {
    case 'auto':
      return t('auto.components.status.bar.FanControlStatusSegment.auto', 'Automatic')
    case 'max':
      return t('auto.components.status.bar.FanControlStatusSegment.max', 'Max speed')
    case 'curve':
      return t('auto.components.status.bar.FanControlStatusSegment.curve', 'Curve')
    case 'smart':
      return t('auto.components.status.bar.FanControlStatusSegment.smart', 'Smart')
    case 'manual':
      return t('auto.components.status.bar.FanControlStatusSegment.manual', 'Manual')
  }
}

function errorNotice(error: FanControlError, t: Translate): string {
  switch (error.kind) {
    case 'auth-cancelled':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.authCancelled',
        'Password cancelled — fans stay automatic.'
      )
    case 'hold-exited':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.holdExited',
        'Fan control stopped — fans are back to automatic.'
      )
    case 'invalid-curve':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.invalidCurve',
        'Could not save the curve.'
      )
    case 'not-controllable':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.notControllable',
        'This Mac has no fans Topo can control.'
      )
    case 'helper-failed':
    case 'invalid-rpm':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.helperFailed',
        'Could not change fan speed.'
      )
  }
}

function FanManualSpeedRow({
  fan,
  target,
  disabled,
  onCommit
}: {
  fan: FanReading
  target: number
  disabled: boolean
  onCommit: (index: number, rpm: number) => void
}): React.JSX.Element {
  const t = useTranslate()
  // Radix only moves a controlled thumb when value changes, so the drag lives here until commit.
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? target
  const rpmFormat = uiNumberFormat(RPM_FORMAT)
  const name = t('auto.components.status.bar.FanControlStatusSegment.fanName', 'Fan {{n}}', {
    n: fan.index + 1
  })
  const rpmText = t('auto.components.status.bar.FanControlStatusSegment.rpm', '{{rpm}} RPM', {
    rpm: rpmFormat.format(shown)
  })

  return (
    <div className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-3 text-2xs">
      <span className="text-muted-foreground">{name}</span>
      <Slider
        min={fan.minRpm}
        max={fan.maxRpm}
        step={50}
        value={[shown]}
        disabled={disabled}
        thumbLabels={[
          t('auto.components.status.bar.FanControlStatusSegment.fanSpeed', 'Fan {{n}} speed', {
            n: fan.index + 1
          })
        ]}
        thumbValueLabels={[rpmText]}
        onValueChange={([value]) => setDragging(value)}
        onValueCommit={([value]) => {
          setDragging(null)
          onCommit(fan.index, value)
        }}
      />
      <span className="text-right tabular-nums text-foreground">{rpmText}</span>
    </div>
  )
}

function PausedModeNotice({
  mode,
  pending,
  onReactivate,
  onDismiss
}: {
  mode: FanControlActiveMode
  pending: boolean
  onReactivate: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
      <p>
        {t(
          'auto.components.status.bar.FanControlStatusSegment.pausedNotice',
          '{{mode}} mode was paused when Topo restarted. Fans are automatic for now.',
          { mode: fanModeLabel(mode, t) }
        )}
      </p>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="xs" onClick={onDismiss}>
          {t('auto.components.status.bar.FanControlStatusSegment.dismiss', 'Dismiss')}
        </Button>
        <Button type="button" size="xs" disabled={pending} onClick={onReactivate}>
          {t('auto.components.status.bar.FanControlStatusSegment.reactivate', 'Reactivate')}
        </Button>
      </div>
    </div>
  )
}

function FanCurveSection({
  status,
  onCurveChange
}: {
  status: SupportedFanControlStatus
  onCurveChange: (curve: FanCurve) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const learned = status.smart.learned
  if (status.mode === 'curve') {
    return (
      <FanCurveEditor
        curve={status.curve}
        thermal={status.thermal}
        learnedPoints={learned.length > 1 ? learned : undefined}
        disabled={status.pending}
        onChange={onCurveChange}
      />
    )
  }
  if (status.mode !== 'smart') {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-muted-foreground">
        {status.smart.answers > 0
          ? t(
              'auto.components.status.bar.FanControlStatusSegment.smartLearned',
              'Learned from {{count}} answers. It never runs fans slower than macOS would.',
              { count: status.smart.answers }
            )
          : t(
              'auto.components.status.bar.FanControlStatusSegment.smartStarting',
              'Starts earlier than macOS and adjusts as you tell it how the Mac feels.'
            )}
      </p>
      {learned.length > 1 ? (
        <FanCurveEditor
          curve={{ source: status.curve.source, points: learned }}
          thermal={status.thermal}
          disabled
          onChange={() => {}}
        />
      ) : null}
    </div>
  )
}

export type FanControlPanelHandlers = {
  onSelectMode: (mode: FanControlMode) => void
  onCurveChange: (curve: FanCurve) => void
  onManualRpm: (index: number, rpm: number) => void
  onDismissPaused: () => void
}

/** Body of the fan popover: header, notices, modes, chart, curve and manual speed. */
export function FanControlPanel({
  status,
  history,
  notice,
  answerPrompt,
  onSelectMode,
  onCurveChange,
  onManualRpm,
  onDismissPaused
}: FanControlPanelHandlers & {
  status: SupportedFanControlStatus
  history: ThermalSample[]
  notice: FanControlError | null
  answerPrompt: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const title = t('auto.components.status.bar.FanControlStatusSegment.title', 'Fan speed')
  const currentLabel = fanModeLabel(status.mode, t)
  const shownError = notice ?? status.lastError ?? null
  const radioValue = isSelectableMode(status.mode) ? status.mode : ''
  const modeNote =
    status.mode === 'max'
      ? t(
          'auto.components.status.bar.FanControlStatusSegment.maxActive',
          'Max speed holds until you pick a mode.'
        )
      : status.mode === 'manual'
        ? t(
            'auto.components.status.bar.FanControlStatusSegment.manualActive',
            'Manual speed holds until you pick a mode.'
          )
        : status.mode === 'auto'
          ? t(
              'auto.components.status.bar.FanControlStatusSegment.autoNote',
              'macOS decides fan speed, as usual.'
            )
          : null

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        {status.controllable ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-medium">{title}</h2>
            <span className="truncate text-xs text-muted-foreground">{currentLabel}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">
              {t('auto.components.status.bar.FanControlStatusSegment.fanlessTitle', 'Temperatures')}
            </h2>
            <p className="text-2xs text-muted-foreground">
              {t(
                'auto.components.status.bar.FanControlStatusSegment.fanlessNote',
                'This Mac has no fans, so Topo shows temperatures only.'
              )}
            </p>
          </div>
        )}
        {status.controllable ? (
          <Button
            type="button"
            variant={status.mode === 'max' ? 'default' : 'outline'}
            size="xs"
            aria-pressed={status.mode === 'max'}
            disabled={status.pending}
            onClick={() => onSelectMode('max')}
          >
            <Gauge />
            {t('auto.components.status.bar.FanControlStatusSegment.maxButton', 'Max')}
          </Button>
        ) : null}
      </div>

      {status.pausedMode && status.controllable ? (
        <PausedModeNotice
          mode={status.pausedMode}
          pending={status.pending}
          onReactivate={() => onSelectMode(status.pausedMode ?? 'auto')}
          onDismiss={onDismissPaused}
        />
      ) : null}

      {shownError ? (
        <p role="status" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 text-destructive" />
          <span>{errorNotice(shownError, t)}</span>
        </p>
      ) : null}

      {answerPrompt ? (
        <div className="rounded-md border border-border p-2.5">{answerPrompt}</div>
      ) : null}

      {status.controllable ? (
        <div className="flex flex-col gap-1.5">
          <RadioGroup
            aria-label={t(
              'auto.components.status.bar.FanControlStatusSegment.modeGroup',
              'Fan mode'
            )}
            value={radioValue}
            onValueChange={(value) => {
              if (isSelectableMode(value)) {
                onSelectMode(value)
              }
            }}
            className="grid-cols-3"
          >
            {SELECTABLE_MODES.map((mode) => (
              <RadioGroupItem key={mode} value={mode} variant="card" disabled={status.pending}>
                <span className="block text-center text-xs font-medium">
                  {fanModeLabel(mode, t)}
                </span>
              </RadioGroupItem>
            ))}
          </RadioGroup>
          {modeNote ? <p className="text-2xs text-muted-foreground">{modeNote}</p> : null}
        </div>
      ) : null}

      <FanThermalChart
        history={history}
        fans={status.fans}
        palmrestAvailable={status.thermal.palmrestAvailable}
      />

      {status.controllable ? (
        <FanCurveSection status={status} onCurveChange={onCurveChange} />
      ) : null}

      {status.controllable && status.fans.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t('auto.components.status.bar.FanControlStatusSegment.manualHeading', 'Manual speed')}
          </h3>
          {status.fans.map((fan) => (
            <FanManualSpeedRow
              key={fan.index}
              fan={fan}
              target={status.manualRpm[fan.index] ?? fan.rpm}
              disabled={status.pending}
              onCommit={onManualRpm}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
