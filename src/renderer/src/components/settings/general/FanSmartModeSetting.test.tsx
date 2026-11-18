// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  type FanControlApi,
  type FanControlStatus,
  type SupportedFanControlStatus
} from '../../../../../shared/fan-control-contract'
import { useAppStore } from '@/store/index'
import { matchesSettingsSearch } from '../search/settings-search'
import { getGeneralPaneSearchEntries } from './general-search'
import { FanSmartModeSetting } from './FanSmartModeSetting'

const confirmDialog = vi.hoisted(() => ({ answer: true, confirm: vi.fn() }))
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => confirmDialog.confirm
}))

const SUPPORTED: SupportedFanControlStatus = {
  supported: true,
  ...NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  mode: 'smart',
  pending: false,
  fans: [{ index: 0, rpm: 2400, minRpm: 2317, maxRpm: 6800 }]
}

function stubFanControl(status: FanControlStatus = SUPPORTED): FanControlApi {
  const api = {
    getStatus: vi.fn(async () => status),
    resetSmartProfile: vi.fn(async () => ({ ok: true as const, status })),
    onChanged: vi.fn(() => () => {})
  } as unknown as FanControlApi
  vi.stubGlobal('api', { fanControl: api })
  return api
}

async function renderSetting(overrides: Partial<GlobalSettings> = {}) {
  const settings = { ...getDefaultSettings('/tmp'), ...overrides }
  const updateSettings = vi.fn()
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<FanSmartModeSetting settings={settings} updateSettings={updateSettings} />)
  })
  return { ...view, updateSettings }
}

function questionsSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: /ask how the mac feels/i })
}

function resetButton(): HTMLElement {
  return screen.getByRole('button', { name: /reset learning/i })
}

beforeEach(() => {
  useAppStore.setState({ settingsSearchQuery: '' })
  confirmDialog.answer = true
  confirmDialog.confirm.mockReset().mockImplementation(async () => confirmDialog.answer)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FanSmartModeSetting questions switch', () => {
  it('is on when fanSmartFeedbackPrompts is true', async () => {
    stubFanControl()
    await renderSetting({ fanSmartFeedbackPrompts: true })
    expect(questionsSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('is off when fanSmartFeedbackPrompts is false', async () => {
    stubFanControl()
    await renderSetting({ fanSmartFeedbackPrompts: false })
    expect(questionsSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('turns the questions back on through updateSettings', async () => {
    stubFanControl()
    const { updateSettings } = await renderSetting({ fanSmartFeedbackPrompts: false })
    act(() => {
      fireEvent.click(questionsSwitch())
    })
    expect(updateSettings).toHaveBeenCalledWith({ fanSmartFeedbackPrompts: true })
  })

  it('turns the questions off through updateSettings', async () => {
    stubFanControl()
    const { updateSettings } = await renderSetting({ fanSmartFeedbackPrompts: true })
    act(() => {
      fireEvent.click(questionsSwitch())
    })
    expect(updateSettings).toHaveBeenCalledWith({ fanSmartFeedbackPrompts: false })
  })
})

describe('FanSmartModeSetting reset learning', () => {
  it('resets the learned profile after the user confirms', async () => {
    const api = stubFanControl()
    await renderSetting()
    await act(async () => {
      fireEvent.click(resetButton())
    })
    expect(confirmDialog.confirm).toHaveBeenCalledTimes(1)
    expect(api.resetSmartProfile).toHaveBeenCalledTimes(1)
  })

  it('keeps the learned profile when the user cancels', async () => {
    const api = stubFanControl()
    confirmDialog.answer = false
    await renderSetting()
    await act(async () => {
      fireEvent.click(resetButton())
    })
    expect(confirmDialog.confirm).toHaveBeenCalledTimes(1)
    expect(api.resetSmartProfile).not.toHaveBeenCalled()
  })

  it('asks a destructive confirmation that names what is lost', async () => {
    stubFanControl()
    await renderSetting()
    await act(async () => {
      fireEvent.click(resetButton())
    })
    const [options] = confirmDialog.confirm.mock.calls[0] as [
      { title: string; confirmVariant?: string }
    ]
    expect(options.title).toMatch(/reset/i)
    expect(options.confirmVariant).toBe('destructive')
  })
})

describe('FanSmartModeSetting platform gating', () => {
  it('renders nothing where fan control is unsupported', async () => {
    stubFanControl({ supported: false, reason: 'not-macos' })
    const { container } = await renderSetting()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing without a fan control bridge', async () => {
    vi.stubGlobal('api', {})
    const { container } = await renderSetting()
    expect(container.innerHTML).toBe('')
  })
})

describe('FanSmartModeSetting search', () => {
  it.each(['fan', 'fans', 'smart'])('shows the row for the query "%s"', async (query) => {
    stubFanControl()
    useAppStore.setState({ settingsSearchQuery: query })
    await renderSetting()
    expect(questionsSwitch()).toBeTruthy()
  })

  it('hides the row for an unrelated query', async () => {
    stubFanControl()
    useAppStore.setState({ settingsSearchQuery: 'worktree' })
    await renderSetting()
    expect(screen.queryByRole('switch', { name: /ask how the mac feels/i })).toBeNull()
  })

  it('is listed in the General pane search entries', () => {
    const fanEntries = getGeneralPaneSearchEntries().filter(
      (entry) => matchesSettingsSearch('fan', entry) && matchesSettingsSearch('smart', entry)
    )
    expect(fanEntries.length).toBeGreaterThan(0)
  })
})
