import { useCallback, useEffect, useState } from 'react'
import { Fan } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { uiNumberFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { PreloadApi } from '../../../../preload/api-types'
import type {
  FanControlApi,
  FanControlError,
  FanControlMode,
  FanControlStatus,
  SupportedFanControlStatus
} from '../../../../shared/fan-control-contract'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'

export type { SupportedFanControlStatus }

// Intl formatter caches key on option identity, so this must be a module constant.
const RPM_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
// Live RPM only while the menu is open; the interval pauses with the window.
const FAN_READING_REFRESH_MS = 2_000

function fanControlBridge(): FanControlApi | undefined {
  // Paired web clients expose a partial bridge without fan control.
  const api: Partial<PreloadApi> | undefined = window.api
  return api?.fanControl
}

function modeLabel(mode: FanControlMode, t: Translate): string {
  return mode === 'max'
    ? t('auto.components.status.bar.FanControlStatusSegment.max', 'Max speed')
    : t('auto.components.status.bar.FanControlStatusSegment.auto', 'Automatic')
}

function errorNotice(error: FanControlError, t: Translate): string {
  switch (error.kind) {
    case 'auth-cancelled':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.authCancelled',
        'Permission cancelled — fans stay automatic.'
      )
    case 'hold-exited':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.holdExited',
        'Max speed stopped — fans are back to automatic.'
      )
    case 'helper-failed':
    case 'invalid-curve':
    case 'invalid-rpm':
    case 'not-controllable':
      return t(
        'auto.components.status.bar.FanControlStatusSegment.helperFailed',
        'Could not change fan speed.'
      )
  }
}

export function FanControlMenuView({
  status,
  iconOnly,
  notice,
  defaultOpen,
  onSelectMode,
  onOpenChange
}: {
  status: SupportedFanControlStatus
  iconOnly: boolean
  notice: FanControlError | null
  defaultOpen?: boolean
  onSelectMode: (mode: FanControlMode) => void
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const isMax = status.mode === 'max'
  const title = t('auto.components.status.bar.FanControlStatusSegment.title', 'Fan speed')
  const currentLabel = modeLabel(status.mode, t)
  const ariaLabel = t(
    'auto.components.status.bar.FanControlStatusSegment.ariaLabel',
    '{{title}}, {{status}}',
    { title, status: currentLabel }
  )
  const shownError = notice ?? status.lastError ?? null
  const rpmFormat = uiNumberFormat(RPM_FORMAT)

  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
              data-fan-mode={status.mode}
              className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              aria-label={ariaLabel}
            >
              <Fan
                className={`size-3 ${isMax ? 'text-foreground' : ''} ${
                  status.pending ? 'motion-safe:animate-spin' : ''
                }`}
              />
              {!iconOnly ? <span className="text-[11px] font-medium">{currentLabel}</span> : null}
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  isMax ? 'bg-foreground' : 'bg-muted-foreground/40'
                }`}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {ariaLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        side="top"
        align="end"
        sideOffset={8}
        className="w-72"
      >
        <DropdownMenuLabel>
          <span className="flex items-center justify-between gap-3">
            <span>{title}</span>
            <span className="font-normal text-muted-foreground">{currentLabel}</span>
          </span>
        </DropdownMenuLabel>
        {status.fans.length > 0 ? (
          <ul className="px-2 pb-1.5 text-[11px] text-muted-foreground">
            {status.fans.map((fan) => (
              <li key={fan.index} className="flex items-center justify-between gap-3 py-0.5">
                <span>
                  {t('auto.components.status.bar.FanControlStatusSegment.fanName', 'Fan {{n}}', {
                    n: fan.index + 1
                  })}
                </span>
                <span className="tabular-nums text-foreground">
                  {t('auto.components.status.bar.FanControlStatusSegment.rpm', '{{rpm}} RPM', {
                    rpm: rpmFormat.format(fan.rpm)
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={status.mode}
          onValueChange={(value) => onSelectMode(value === 'max' ? 'max' : 'auto')}
        >
          <DropdownMenuRadioItem value="auto" disabled={status.pending}>
            <span className="flex flex-col">
              <span>{modeLabel('auto', t)}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t(
                  'auto.components.status.bar.FanControlStatusSegment.autoDescription',
                  'macOS adjusts fan speed to temperature'
                )}
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="max" disabled={status.pending}>
            <span className="flex flex-col">
              <span>{modeLabel('max', t)}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t(
                  'auto.components.status.bar.FanControlStatusSegment.maxDescription',
                  'Run all fans at full speed. Needs your administrator password; fans return to automatic when Topo closes.'
                )}
              </span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {shownError ? (
          <>
            <DropdownMenuSeparator />
            <p role="status" className="px-2 py-1.5 text-[11px] text-muted-foreground">
              {errorNotice(shownError, t)}
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FanControlStatusSegment({
  iconOnly
}: {
  iconOnly: boolean
}): React.JSX.Element | null {
  const [status, setStatus] = useState<FanControlStatus | null>(null)
  const [notice, setNotice] = useState<FanControlError | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const api = fanControlBridge()
    if (!api || isPairedWebClientWindow()) {
      return
    }
    let mounted = true
    const unsubscribe = api.onChanged((next) => {
      if (mounted) {
        setStatus(next)
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
    if (!menuOpen || !api) {
      return
    }
    api.setMonitoring(true)
    const stop = installWindowVisibilityInterval({
      run: () => api.setMonitoring(true),
      intervalMs: FAN_READING_REFRESH_MS
    })
    return () => {
      stop()
      api.setMonitoring(false)
    }
  }, [menuOpen])

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setNotice(null)
    }
    setMenuOpen(open)
  }, [])

  const handleSelectMode = useCallback((mode: FanControlMode) => {
    const api = fanControlBridge()
    if (!api) {
      return
    }
    setNotice(null)
    void api
      .setMode(mode)
      .then((result) => {
        setStatus(result.status)
        setNotice(result.ok ? null : result.error)
      })
      .catch(() => setNotice({ kind: 'helper-failed', detail: '' }))
  }, [])

  if (isPairedWebClientWindow() || !status?.supported) {
    return null
  }

  return (
    <FanControlMenuView
      status={status}
      iconOnly={iconOnly}
      notice={notice}
      onSelectMode={handleSelectMode}
      onOpenChange={handleOpenChange}
    />
  )
}
