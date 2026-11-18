// @vitest-environment happy-dom

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FanControlApi,
  FanControlSetResult,
  FanControlStatus
} from '../../../../shared/fan-control-contract'
import { FanControlStatusSegment } from './FanControlStatusSegment'

const chrome = vi.hoisted(() => ({ pairedWeb: false }))
vi.mock('@/lib/desktop-window-chrome', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isPairedWebClientWindow: () => chrome.pairedWeb
}))

// Radix portals and pointer gating are not under test; render menu content inline.
vi.mock('@/components/ui/dropdown-menu', () => {
  const RadioContext = createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => (
      <div role="menu">{children}</div>
    ),
    DropdownMenuLabel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange
    }: {
      children?: ReactNode
      value?: string
      onValueChange?: (v: string) => void
    }) => {
      const radio = useMemo(() => ({ value, onValueChange }), [value, onValueChange])
      return <RadioContext.Provider value={radio}>{children}</RadioContext.Provider>
    },
    DropdownMenuRadioItem: ({
      children,
      value,
      disabled
    }: {
      children?: ReactNode
      value: string
      disabled?: boolean
    }) => {
      const radio = useContext(RadioContext)
      return (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={radio.value === value}
          disabled={disabled}
          onClick={() => radio.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    }
  }
})
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: Pass, TooltipProvider: Pass }
})

const AUTO: FanControlStatus = {
  supported: true,
  mode: 'auto',
  pending: false,
  fans: [
    { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 },
    { index: 1, rpm: 2510, minRpm: 2317, maxRpm: 6800 }
  ]
}
const MAX: FanControlStatus = {
  ...AUTO,
  mode: 'max',
  fans: AUTO.fans.map((f) => ({ ...f, rpm: 6790 }))
}

type ApiStub = FanControlApi & { emit: (status: FanControlStatus) => void }

function stubApi(initial: FanControlStatus, setResult?: FanControlSetResult): ApiStub {
  let listener: ((status: FanControlStatus) => void) | null = null
  const api: ApiStub = {
    getStatus: vi.fn(async () => initial),
    setMode: vi.fn(async () => setResult ?? { ok: true as const, status: MAX }),
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
  return screen.getByRole('button', { name: /fan/i })
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
    stubApi({ supported: false, reason: 'no-fans' })
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
})

describe('FanControlStatusSegment state', () => {
  it('marks the trigger as active only in max mode', async () => {
    const api = stubApi(AUTO)
    await mount()
    expect(trigger().getAttribute('data-fan-mode')).toBe('auto')
    act(() => api.emit(MAX))
    expect(trigger().getAttribute('data-fan-mode')).toBe('max')
  })

  it('lists Automatic and Max speed with per-fan RPM', async () => {
    stubApi(AUTO)
    await mount()
    const options = screen.getAllByRole('menuitemradio')
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toMatch(/automatic/i)
    expect(options[1].textContent).toMatch(/max/i)
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    const menu = screen.getByRole('menu')
    expect(menu.textContent).toMatch(/2[,.]?300/)
    expect(menu.textContent).toMatch(/2[,.]?510/)
    expect(menu.textContent).toMatch(/rpm/i)
  })

  it('calls setMode with the chosen option', async () => {
    const api = stubApi(AUTO)
    await mount()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('menuitemradio')[1])
    })
    expect(api.setMode).toHaveBeenCalledWith('max')
  })

  it('tells the user the fans stayed automatic when the password prompt is cancelled', async () => {
    stubApi(AUTO, { ok: false, error: { kind: 'auth-cancelled' }, status: AUTO })
    await mount()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('menuitemradio')[1])
    })
    const notice = screen.getByRole('status')
    expect(notice.textContent).toMatch(/cancel/i)
    expect(notice.textContent).toMatch(/automatic/i)
  })

  it('disables both options while a change is pending', async () => {
    stubApi({ ...AUTO, pending: true })
    await mount()
    for (const option of screen.getAllByRole('menuitemradio')) {
      expect(option.hasAttribute('disabled')).toBe(true)
    }
  })
})
