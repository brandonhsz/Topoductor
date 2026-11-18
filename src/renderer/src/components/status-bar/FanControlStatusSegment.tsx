import { useCallback, useEffect, useRef, useState } from 'react'
import { Fan } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/i18n/use-translate'
import type { PreloadApi } from '../../../../preload/api-types'
import type {
  FanControlApi,
  FanControlError,
  FanControlMode,
  FanControlSetResult,
  FanControlStatus,
  FanCurve,
  FanFeedbackReply,
  SupportedFanControlStatus,
  ThermalSample
} from '../../../../shared/fan-control-contract'
import { FanControlPanel, fanModeLabel, type FanControlPanelHandlers } from './FanControlPanel'
import { FanFeedbackPrompt } from './FanFeedbackPrompt'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'

export type { SupportedFanControlStatus }

// Live readings only while the panel is open; the interval pauses with the window.
const FAN_READING_REFRESH_MS = 2_000
// Matches the ten minutes of history main keeps.
const HISTORY_WINDOW_MS = 10 * 60_000
const MIN_SAMPLE_GAP_MS = 1_000

function fanControlBridge(): FanControlApi | undefined {
  // Paired web clients expose a partial bridge without fan control.
  const api: Partial<PreloadApi> | undefined = window.api
  return api?.fanControl
}

function liveSample(status: SupportedFanControlStatus, at: number): ThermalSample {
  return { ...status.thermal, at, fanRpm: status.fans.map((fan) => fan.rpm) }
}

function appendLiveSample(history: ThermalSample[], sample: ThermalSample): ThermalSample[] {
  const last = history.at(-1)
  if (last && sample.at - last.at < MIN_SAMPLE_GAP_MS) {
    return history
  }
  const since = sample.at - HISTORY_WINDOW_MS
  return [...history.filter((s) => s.at >= since), sample]
}

export function FanControlPanelView({
  status,
  history,
  iconOnly,
  notice,
  answering,
  open,
  defaultOpen,
  onOpenChange,
  onSelectMode,
  onCurveChange,
  onManualRpm,
  onDismissPaused,
  onAnswerFeedback
}: FanControlPanelHandlers & {
  onAnswerFeedback: (reply: FanFeedbackReply) => void
  status: SupportedFanControlStatus
  history: ThermalSample[]
  iconOnly: boolean
  notice: FanControlError | null
  answering: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [panelOpenInner, setPanelOpenInner] = useState(defaultOpen ?? false)
  const panelOpen = open ?? panelOpenInner
  const panelRef = useRef<HTMLDivElement>(null)
  const handleOpenChange = (next: boolean): void => {
    setPanelOpenInner(next)
    onOpenChange?.(next)
  }
  const isActive = status.mode !== 'auto'
  const title = t('auto.components.status.bar.FanControlStatusSegment.title', 'Fan speed')
  const currentLabel = fanModeLabel(status.mode, t)
  const statusText = status.pausedMode
    ? t(
        'auto.components.status.bar.FanControlStatusSegment.pausedStatus',
        '{{status}}, {{mode}} paused',
        { status: currentLabel, mode: fanModeLabel(status.pausedMode, t) }
      )
    : currentLabel
  const ariaLabel = t(
    'auto.components.status.bar.FanControlStatusSegment.ariaLabel',
    '{{title}}, {{status}}',
    { title, status: statusText }
  )
  const prompt = status.feedbackPrompt

  const answerPrompt = prompt ? (
    <FanFeedbackPrompt prompt={prompt} pending={answering} onAnswer={onAnswerFeedback} />
  ) : null

  return (
    // The question floats on its own while the panel is closed; with the panel open it moves inside.
    <Popover open={prompt !== null && !panelOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Popover open={panelOpen} onOpenChange={handleOpenChange}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                    data-fan-mode={status.mode}
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                    aria-label={ariaLabel}
                  >
                    <Fan
                      className={cn(
                        'size-3',
                        isActive && 'text-foreground',
                        status.pending && 'motion-safe:animate-spin'
                      )}
                    />
                    {!iconOnly ? (
                      <span className="text-2xs font-medium">{currentLabel}</span>
                    ) : null}
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        isActive
                          ? 'bg-foreground'
                          : status.pausedMode
                            ? 'border border-foreground'
                            : 'bg-muted-foreground/40'
                      )}
                    />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {ariaLabel}
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
              side="top"
              align="end"
              sideOffset={8}
              wheelScroll
              ref={panelRef}
              tabIndex={-1}
              aria-label={title}
              className="w-[360px]"
              // Land on the panel itself so Tab reaches every control without a stray focus ring.
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                panelRef.current?.focus()
              }}
            >
              <div className="flex max-h-[var(--radix-popover-content-available-height)] flex-col gap-3 overflow-y-auto p-3 scrollbar-sleek">
                <FanControlPanel
                  status={status}
                  history={history}
                  notice={notice}
                  answerPrompt={answerPrompt}
                  onSelectMode={onSelectMode}
                  onCurveChange={onCurveChange}
                  onManualRpm={onManualRpm}
                  onDismissPaused={onDismissPaused}
                />
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </PopoverAnchor>
      <PopoverContent
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        side="top"
        align="end"
        sideOffset={8}
        aria-label={title}
        className="w-72"
        // A question must not pull focus from the terminal or editor.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="p-3">{answerPrompt}</div>
      </PopoverContent>
    </Popover>
  )
}

export function FanControlStatusSegment({
  iconOnly
}: {
  iconOnly: boolean
}): React.JSX.Element | null {
  const [status, setStatus] = useState<FanControlStatus | null>(null)
  const [notice, setNotice] = useState<FanControlError | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [history, setHistory] = useState<ThermalSample[]>([])
  const [draftCurve, setDraftCurve] = useState<FanCurve | null>(null)
  const [answering, setAnswering] = useState(false)
  const panelOpenRef = useRef(false)
  const curveRequestRef = useRef(0)

  useEffect(() => {
    const api = fanControlBridge()
    if (!api || isPairedWebClientWindow()) {
      return
    }
    let mounted = true
    const unsubscribe = api.onChanged((next) => {
      if (!mounted) {
        return
      }
      setStatus(next)
      if (panelOpenRef.current && next.supported) {
        const sample = liveSample(next, Date.now())
        setHistory((prev) => appendLiveSample(prev, sample))
      }
    })
    void api
      .getStatus()
      .then((next) => {
        if (mounted) {
          setStatus(next)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const api = fanControlBridge()
    if (!panelOpen || !api) {
      return
    }
    let active = true
    api.setMonitoring(true)
    const stop = installWindowVisibilityInterval({
      run: () => api.setMonitoring(true),
      intervalMs: FAN_READING_REFRESH_MS
    })
    void api
      .getHistory()
      .then((samples) => {
        if (!active) {
          return
        }
        const lastAt = samples.at(-1)?.at ?? 0
        // Keep live samples that arrived while history was loading.
        setHistory((prev) => [...samples, ...prev.filter((s) => s.at > lastAt)])
      })
      .catch(() => {})
    return () => {
      active = false
      stop()
      api.setMonitoring(false)
    }
  }, [panelOpen])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      panelOpenRef.current = open
      if (open) {
        setNotice(null)
        setHistory(status?.supported ? [liveSample(status, Date.now())] : [])
      }
      setPanelOpen(open)
    },
    [status]
  )

  const applyResult = useCallback((result: FanControlSetResult) => {
    setStatus(result.status)
    setNotice(result.ok ? null : result.error)
  }, [])

  const handleSelectMode = useCallback(
    (mode: FanControlMode) => {
      const api = fanControlBridge()
      if (!api) {
        return
      }
      setNotice(null)
      void api
        .setMode(mode)
        .then(applyResult)
        .catch(() => setNotice({ kind: 'helper-failed', detail: '' }))
    },
    [applyResult]
  )

  const handleCurveChange = useCallback(
    (curve: FanCurve) => {
      const api = fanControlBridge()
      if (!api) {
        return
      }
      curveRequestRef.current += 1
      const request = curveRequestRef.current
      // Keeps a dragged point under the pointer while the save round-trips.
      setDraftCurve(curve)
      const settle = (): void => {
        if (request === curveRequestRef.current) {
          setDraftCurve(null)
        }
      }
      void api
        .setCurve(curve)
        .then((result) => {
          applyResult(result)
          settle()
        })
        .catch(() => {
          setNotice({ kind: 'invalid-curve', detail: '' })
          settle()
        })
    },
    [applyResult]
  )

  const handleManualRpm = useCallback(
    (index: number, rpm: number) => {
      const api = fanControlBridge()
      if (!api) {
        return
      }
      void api
        .setManualRpm(index, rpm)
        .then(applyResult)
        .catch(() => setNotice({ kind: 'helper-failed', detail: '' }))
    },
    [applyResult]
  )

  const handleDismissPaused = useCallback(() => {
    const api = fanControlBridge()
    if (!api) {
      return
    }
    void api
      .dismissPausedMode()
      .then(setStatus)
      .catch(() => {})
  }, [])

  const promptId = status?.supported ? status.feedbackPrompt?.id : undefined
  const handleAnswerFeedback = useCallback(
    (reply: FanFeedbackReply) => {
      const api = fanControlBridge()
      if (!api || !promptId) {
        return
      }
      setAnswering(true)
      void api
        .answerFeedback(promptId, reply)
        .then(applyResult)
        .catch(() => setNotice({ kind: 'helper-failed', detail: '' }))
        .finally(() => setAnswering(false))
    },
    [applyResult, promptId]
  )

  if (isPairedWebClientWindow() || !status?.supported) {
    return null
  }

  return (
    <FanControlPanelView
      status={draftCurve ? { ...status, curve: draftCurve } : status}
      history={history}
      iconOnly={iconOnly}
      notice={notice}
      answering={answering}
      open={panelOpen}
      onOpenChange={handleOpenChange}
      onSelectMode={handleSelectMode}
      onCurveChange={handleCurveChange}
      onManualRpm={handleManualRpm}
      onDismissPaused={handleDismissPaused}
      onAnswerFeedback={handleAnswerFeedback}
    />
  )
}
