// @vitest-environment happy-dom

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode
} from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  type FanControlApi,
  type FanControlSetResult,
  type FanControlStatus,
  type FanCurve,
  type SupportedFanControlStatus
} from '../../../../shared/fan-control-contract'
import type { Slider } from '@/components/ui/slider'
import { FanControlStatusSegment } from './FanControlStatusSegment'

const chrome = vi.hoisted(() => ({ pairedWeb: false }))
vi.mock('@/lib/desktop-window-chrome', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isPairedWebClientWindow: () => chrome.pairedWeb
}))

// Radix portals and focus gating are not under test; the trigger toggles inline content.
vi.mock('@/components/ui/popover', () => {
  type PopoverState = { open: boolean; setOpen: (open: boolean) => void }
  const PopoverContext = createContext<PopoverState>({ open: false, setOpen: () => {} })
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  function Popover({
    children,
    open,
    defaultOpen,
    onOpenChange
  }: {
    children?: ReactNode
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
  }) {
    const [inner, setInner] = useState(defaultOpen ?? false)
    const isOpen = open ?? inner
    const state = useMemo<PopoverState>(
      () => ({
        open: isOpen,
        setOpen: (next) => {
          setInner(next)
          onOpenChange?.(next)
        }
      }),
      [isOpen, onOpenChange]
    )
    return <PopoverContext.Provider value={state}>{children}</PopoverContext.Provider>
  }
  function PopoverTrigger({ children }: { children?: ReactNode }) {
    const { open, setOpen } = useContext(PopoverContext)
    if (!isValidElement<{ onClick?: (event: MouseEvent) => void }>(children)) {
      return <>{children}</>
    }
    return cloneElement(children, {
      onClick: (event: MouseEvent) => {
        children.props.onClick?.(event)
        setOpen(!open)
      }
    })
  }
  function PopoverContent({ children }: { children?: ReactNode }) {
    return useContext(PopoverContext).open ? <div role="dialog">{children}</div> : null
  }
  return {
    Popover,
    PopoverTrigger,
    PopoverAnchor: Pass,
    PopoverArrow: () => null,
    PopoverContent
  }
})
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: Pass, TooltipProvider: Pass }
})
// Radix Slider needs layout; a range input keeps value, bounds and commit observable.
vi.mock('@/components/ui/slider', () => ({
  Slider: function MockSlider({
    value,
    min,
    max,
    disabled,
    thumbLabels,
    onValueChange,
    onValueCommit
  }: ComponentProps<typeof Slider>) {
    // Radix commits the dragged value even when the parent has not re-rendered with it yet.
    const dragged = useRef<number | null>(null)
    return (
      <input
        type="range"
        aria-label={thumbLabels?.[0]}
        min={min}
        max={max}
        value={value?.[0]}
        disabled={disabled}
        onChange={(event) => {
          dragged.current = Number(event.target.value)
          onValueChange?.([dragged.current])
        }}
        onPointerUp={(event) =>
          onValueCommit?.([dragged.current ?? Number(event.currentTarget.value)])
        }
      />
    )
  }
}))

const CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 60, percent: 0 },
    { tempC: 80, percent: 70 }
  ]
}

const AUTO: SupportedFanControlStatus = {
  supported: true,
  ...NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  thermal: { chipC: 71, palmrestC: 33, blendC: 59, palmrestAvailable: true },
  curve: CURVE,
  mode: 'auto',
  pending: false,
  fans: [
    { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 },
    { index: 1, rpm: 2510, minRpm: 2317, maxRpm: 6800 }
  ],
  appliedRpm: [null, null]
}
const MAX: SupportedFanControlStatus = {
  ...AUTO,
  mode: 'max',
  fans: AUTO.fans.map((f) => ({ ...f, rpm: 6790 })),
  session: 'active',
  appliedRpm: [6800, 6800]
}
const FANLESS: SupportedFanControlStatus = {
  ...AUTO,
  controllable: false,
  fans: [],
  appliedRpm: []
}

type ApiStub = FanControlApi & { emit: (status: FanControlStatus) => void }

function stubApi(initial: FanControlStatus, setResult?: FanControlSetResult): ApiStub {
  let listener: ((status: FanControlStatus) => void) | null = null
  const api: ApiStub = {
    getStatus: vi.fn(async () => initial),
    getHistory: vi.fn(async () => []),
    setMode: vi.fn(async () => setResult ?? { ok: true as const, status: MAX }),
    setCurve: vi.fn(async (curve: FanCurve) => ({
      ok: true as const,
      status: initial.supported ? { ...initial, curve } : initial
    })),
    setManualRpm: vi.fn(async () => ({ ok: true as const, status: initial })),
    answerFeedback: vi.fn(async () => ({ ok: true as const, status: initial })),
    resetSmartProfile: vi.fn(async () => ({ ok: true as const, status: initial })),
    dismissPausedMode: vi.fn(async () =>
      initial.supported ? { ...initial, pausedMode: null } : initial
    ),
    setMonitoring: vi.fn(),
    onChanged: vi.fn((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    }),
    emit: (status) => listener?.(status)
  }
  vi.stubGlobal('api', { fanControl: api })
  return api
}

async function mount(): Promise<ReturnType<typeof render>> {
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<FanControlStatusSegment iconOnly={false} />)
  })
  return view
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^fan speed/i })
}

async function openPanel(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(trigger())
  })
  return screen.getByRole('dialog')
}

function modeGroup(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole('radiogroup', { name: /mode/i })
}

function modeRadio(panel: HTMLElement, name: RegExp): HTMLElement {
  return within(modeGroup(panel)).getByRole('radio', { name })
}

function maxButton(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole('button', { name: /^max/i })
}

function fanSlider(panel: HTMLElement, n: number): HTMLInputElement {
  const slider = within(panel).getByRole('slider', { name: new RegExp(`fan ${n}`, 'i') })
  if (!(slider instanceof HTMLInputElement)) {
    throw new Error(`expected fan ${n} slider to be an input`)
  }
  return slider
}

beforeEach(() => {
  chrome.pairedWeb = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FanControlStatusSegment visibility', () => {
  it('renders nothing when fan control is unsupported', async () => {
    stubApi({ supported: false, reason: 'not-macos' })
    const { container } = await mount()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing in a paired web client window', async () => {
    chrome.pairedWeb = true
    stubApi(AUTO)
    const { container } = await mount()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the bridge has no fanControl api', async () => {
    vi.stubGlobal('api', {})
    const { container } = await mount()
    expect(container.innerHTML).toBe('')
  })

  it('hides itself when a later status reports write-rejected', async () => {
    const api = stubApi(AUTO)
    const { container } = await mount()
    expect(trigger()).toBeTruthy()
    act(() => api.emit({ supported: false, reason: 'write-rejected' }))
    expect(container.innerHTML).toBe('')
  })

  it('keeps the trigger on a fanless Mac so temperatures stay reachable', async () => {
    stubApi(FANLESS)
    await mount()
    expect(trigger()).toBeTruthy()
  })
})

describe('FanControlStatusSegment trigger', () => {
  it('reflects the current mode', async () => {
    const api = stubApi(AUTO)
    await mount()
    expect(trigger().getAttribute('data-fan-mode')).toBe('auto')
    act(() => api.emit(MAX))
    expect(trigger().getAttribute('data-fan-mode')).toBe('max')
    act(() => api.emit({ ...AUTO, mode: 'manual' }))
    expect(trigger().getAttribute('data-fan-mode')).toBe('manual')
  })

  it('keeps the panel closed until the trigger is clicked', async () => {
    stubApi(AUTO)
    await mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    await openPanel()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('polls live readings and loads history only while the panel is open', async () => {
    const api = stubApi(AUTO)
    await mount()
    expect(api.setMonitoring).not.toHaveBeenCalledWith(true)
    await openPanel()
    expect(api.setMonitoring).toHaveBeenLastCalledWith(true)
    expect(api.getHistory).toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(trigger())
    })
    expect(api.setMonitoring).toHaveBeenLastCalledWith(false)
  })
})

describe('FanControlStatusSegment modes', () => {
  it('offers Automatic, Curve and Smart as modes and checks the current one', async () => {
    stubApi({ ...AUTO, mode: 'curve' })
    await mount()
    const panel = await openPanel()
    const radios = within(modeGroup(panel)).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(modeRadio(panel, /^automatic/i).getAttribute('aria-checked')).toBe('false')
    expect(modeRadio(panel, /^curve/i).getAttribute('aria-checked')).toBe('true')
    expect(modeRadio(panel, /^smart/i).getAttribute('aria-checked')).toBe('false')
  })

  it.each([
    [/^curve/i, 'curve'],
    [/^smart/i, 'smart']
  ] as const)('selecting %s calls setMode', async (name, mode) => {
    const api = stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    await act(async () => {
      fireEvent.click(modeRadio(panel, name))
    })
    expect(api.setMode).toHaveBeenCalledWith(mode)
  })

  it('selecting Automatic hands the fans back to macOS', async () => {
    const api = stubApi({ ...AUTO, mode: 'smart' })
    await mount()
    const panel = await openPanel()
    await act(async () => {
      fireEvent.click(modeRadio(panel, /^automatic/i))
    })
    expect(api.setMode).toHaveBeenCalledWith('auto')
  })

  it('shows per-fan RPM', async () => {
    stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    expect(panel.textContent).toMatch(/2[,.]?300/)
    expect(panel.textContent).toMatch(/2[,.]?510/)
    expect(panel.textContent).toMatch(/rpm/i)
  })

  it('shows the current temperatures', async () => {
    stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    expect(panel.textContent).toMatch(/71\s?°C/)
    expect(panel.textContent).toMatch(/33\s?°C/)
    expect(panel.textContent).toMatch(/59\s?°C/)
  })
})

describe('FanControlStatusSegment Max button', () => {
  it('calls setMode("max") with one click', async () => {
    const api = stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    expect(maxButton(panel).getAttribute('aria-pressed')).toBe('false')
    await act(async () => {
      fireEvent.click(maxButton(panel))
    })
    expect(api.setMode).toHaveBeenCalledWith('max')
  })

  it('shows Max as pressed and no mode as checked while at max', async () => {
    stubApi(MAX)
    await mount()
    const panel = await openPanel()
    expect(maxButton(panel).getAttribute('aria-pressed')).toBe('true')
    for (const radio of within(modeGroup(panel)).getAllByRole('radio')) {
      expect(radio.getAttribute('aria-checked')).toBe('false')
    }
  })
})

describe('FanControlStatusSegment manual speed', () => {
  it('shows one slider per fan bounded by its real min and max RPM', async () => {
    stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    expect(within(panel).getAllByRole('slider', { name: /fan \d/i })).toHaveLength(2)
    const first = fanSlider(panel, 1)
    expect(first.min).toBe('2317')
    expect(first.max).toBe('6800')
  })

  it('starts each slider at the manual target, or the live RPM without one', async () => {
    stubApi({ ...AUTO, mode: 'manual', manualRpm: { 0: 4000 } })
    await mount()
    const panel = await openPanel()
    expect(fanSlider(panel, 1).value).toBe('4000')
    expect(fanSlider(panel, 2).value).toBe('2510')
  })

  it('shows the live RPM, not a saved manual target, outside manual mode', async () => {
    const fans = [
      { ...AUTO.fans[0], rpm: 3100 },
      { ...AUTO.fans[1], rpm: 2510 }
    ]
    stubApi({ ...AUTO, mode: 'auto', fans, manualRpm: { 0: 4000 } })
    await mount()
    const panel = await openPanel()
    expect(fanSlider(panel, 1).value).toBe('3100')
    expect(within(panel).queryByText(/4,000 RPM/)).toBeNull()
  })

  it('sends the committed RPM for that fan', async () => {
    const api = stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    const second = fanSlider(panel, 2)
    await act(async () => {
      fireEvent.change(second, { target: { value: '4200' } })
      fireEvent.pointerUp(second)
    })
    expect(api.setManualRpm).toHaveBeenLastCalledWith(1, 4200)
    expect(api.setManualRpm).not.toHaveBeenCalledWith(0, expect.anything())
  })
})

describe('FanControlStatusSegment curve editing', () => {
  it('saves the edited curve without changing mode', async () => {
    const api = stubApi({ ...AUTO, mode: 'curve' })
    await mount()
    const panel = await openPanel()
    const [firstPoint] = within(panel).getAllByRole('slider', { name: /point/i })
    await act(async () => {
      fireEvent.keyDown(firstPoint, { key: 'ArrowRight' })
    })
    expect(api.setCurve).toHaveBeenCalled()
    const saved = vi.mocked(api.setCurve).mock.calls.at(-1)?.[0]
    expect(saved?.source).toBe('blend')
    expect(saved?.points[0].tempC).toBeGreaterThan(60)
    expect(saved?.points[1]).toEqual(CURVE.points[1])
    expect(api.setMode).not.toHaveBeenCalled()
  })
})

describe('FanControlStatusSegment pending', () => {
  it('disables modes, Max and manual sliders while a change is pending', async () => {
    stubApi({ ...AUTO, pending: true })
    await mount()
    const panel = await openPanel()
    for (const radio of within(modeGroup(panel)).getAllByRole('radio')) {
      expect(radio.hasAttribute('disabled')).toBe(true)
    }
    expect(maxButton(panel).hasAttribute('disabled')).toBe(true)
    expect(fanSlider(panel, 1).disabled).toBe(true)
  })
})

describe('FanControlStatusSegment paused mode', () => {
  it('flags the paused mode on the trigger without opening the panel', async () => {
    const api = stubApi({ ...AUTO, pausedMode: 'smart' })
    await mount()
    expect(trigger().getAttribute('aria-label')).toMatch(/paused/i)
    act(() => api.emit(AUTO))
    expect(trigger().getAttribute('aria-label')).not.toMatch(/paused/i)
  })

  it('offers Reactivate, which resumes the paused mode', async () => {
    const api = stubApi({ ...AUTO, pausedMode: 'smart' })
    await mount()
    const panel = await openPanel()
    expect(panel.textContent).toMatch(/smart/i)
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: /reactivate/i }))
    })
    expect(api.setMode).toHaveBeenCalledWith('smart')
  })

  it('offers Dismiss, which clears the notice', async () => {
    const api = stubApi({ ...AUTO, pausedMode: 'curve' })
    await mount()
    const panel = await openPanel()
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: /dismiss/i }))
    })
    expect(api.dismissPausedMode).toHaveBeenCalledTimes(1)
    expect(api.setMode).not.toHaveBeenCalled()
    expect(within(panel).queryByRole('button', { name: /reactivate/i })).toBeNull()
  })

  it('shows no notice without a paused mode', async () => {
    stubApi(AUTO)
    await mount()
    const panel = await openPanel()
    expect(within(panel).queryByRole('button', { name: /reactivate/i })).toBeNull()
  })
})

describe('FanControlStatusSegment errors', () => {
  it('tells the user the fans stayed automatic when the password prompt is cancelled', async () => {
    stubApi(AUTO, { ok: false, error: { kind: 'auth-cancelled' }, status: AUTO })
    await mount()
    const panel = await openPanel()
    await act(async () => {
      fireEvent.click(modeRadio(panel, /^curve/i))
    })
    expect(panel.textContent).toMatch(/cancel/i)
    expect(panel.textContent).toMatch(/automatic/i)
  })

  it('reports a control session that exited on its own', async () => {
    stubApi({ ...AUTO, lastError: { kind: 'hold-exited', detail: 'exit 1' } })
    await mount()
    const panel = await openPanel()
    expect(within(panel).getByRole('status').textContent).toMatch(/automatic/i)
  })
})

describe('FanControlStatusSegment fanless Mac', () => {
  it('shows temperatures only', async () => {
    stubApi(FANLESS)
    await mount()
    const panel = await openPanel()
    expect(panel.textContent).toMatch(/71\s?°C/)
    expect(within(panel).queryByRole('radiogroup', { name: /mode/i })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /^max/i })).toBeNull()
    expect(within(panel).queryAllByRole('slider')).toHaveLength(0)
  })
})

describe('FanControlStatusSegment feedback prompt', () => {
  const PROMPT = { id: 'prompt-7', askedAt: 1_700_000_000_000, tempC: 62 }

  it('asks with the panel closed and sends the answer with the prompt id', async () => {
    const api = stubApi({ ...AUTO, mode: 'smart', feedbackPrompt: PROMPT })
    await mount()
    expect(screen.queryByRole('radiogroup', { name: /mode/i })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^hot$/i }))
    })
    expect(api.answerFeedback).toHaveBeenCalledWith('prompt-7', 'hot')
  })

  it('sends never from "Don\'t ask again"', async () => {
    const api = stubApi({ ...AUTO, mode: 'smart', feedbackPrompt: PROMPT })
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ask again/i }))
    })
    expect(api.answerFeedback).toHaveBeenCalledWith('prompt-7', 'never')
  })

  it('removes the question when main clears it', async () => {
    const api = stubApi({ ...AUTO, mode: 'smart', feedbackPrompt: PROMPT })
    await mount()
    expect(screen.getByRole('button', { name: /^cold$/i })).toBeTruthy()
    act(() => api.emit({ ...AUTO, mode: 'smart', feedbackPrompt: null }))
    expect(screen.queryByRole('button', { name: /^cold$/i })).toBeNull()
  })

  it('asks nothing without a pending prompt', async () => {
    stubApi({ ...AUTO, mode: 'smart' })
    await mount()
    await openPanel()
    expect(screen.queryByRole('button', { name: /^warm$/i })).toBeNull()
  })
})
