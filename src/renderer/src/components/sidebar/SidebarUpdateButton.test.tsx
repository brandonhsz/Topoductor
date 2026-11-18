// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
import { SidebarUpdateButton } from './SidebarUpdateButton'

const mocks = vi.hoisted(() => ({ web: false }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.web }))

const VERSION = '1.4.300'
const check = vi.fn()
const download = vi.fn()
const quitAndInstall = vi.fn()

function setStatus(status: UpdateStatus): void {
  act(() => useAppStore.getState().setUpdateStatus(status))
}

function renderButton(): void {
  render(
    <TooltipProvider>
      <SidebarUpdateButton />
    </TooltipProvider>
  )
}

function updateButton(name: RegExp = /update/i): HTMLElement {
  return screen.getByRole('button', { name })
}

beforeEach(() => {
  mocks.web = false
  useAppStore.setState(useAppStore.getInitialState(), true)
  check.mockReset().mockResolvedValue(undefined)
  download.mockReset().mockResolvedValue(undefined)
  quitAndInstall.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  )
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { updater: { check, download, quitAndInstall } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

describe('SidebarUpdateButton', () => {
  it('checks for updates from idle with the same options as the help menu', () => {
    renderButton()
    setStatus({ state: 'idle' })
    const button = updateButton(/check for updates/i)
    expect(within(button).queryByText('!')).toBeNull()

    fireEvent.click(button)
    expect(check).toHaveBeenCalledWith(
      getUpdateCheckClickOptions({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })
    )
  })

  it('forwards click modifiers to the update check', () => {
    renderButton()
    setStatus({ state: 'not-available' })
    const button = updateButton(/check for updates/i)
    const modifiers = { altKey: false, ctrlKey: true, metaKey: true, shiftKey: true }

    fireEvent.pointerDown(button, modifiers)
    fireEvent.click(button, modifiers)
    expect(check).toHaveBeenCalledWith(getUpdateCheckClickOptions(modifiers))
  })

  it('shows a badge and the version when an update is available, even if the card was dismissed', () => {
    renderButton()
    act(() => useAppStore.setState({ dismissedUpdateVersion: VERSION }))
    setStatus({ state: 'available', version: VERSION, changelog: null })

    const button = updateButton(new RegExp(VERSION.replaceAll('.', '\\.')))
    expect(within(button).getByText('!')).toBeTruthy()
  })

  it('downloads then installs exactly once when applying an available update', async () => {
    renderButton()
    setStatus({ state: 'available', version: VERSION, changelog: null })

    fireEvent.click(updateButton(new RegExp(VERSION.replaceAll('.', '\\.'))))
    expect(download).toHaveBeenCalledTimes(1)
    expect(quitAndInstall).not.toHaveBeenCalled()

    setStatus({ state: 'downloading', version: VERSION, percent: 50 })
    setStatus({ state: 'downloaded', version: VERSION })
    setStatus({ state: 'downloaded', version: VERSION })
    await act(async () => {})
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not install a download it did not start', async () => {
    renderButton()
    setStatus({ state: 'downloading', version: VERSION, percent: 10 })
    setStatus({ state: 'downloaded', version: VERSION })
    await act(async () => {})
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('installs a ready update on click', () => {
    renderButton()
    setStatus({ state: 'downloaded', version: VERSION })

    const button = updateButton(/ready/i)
    expect(within(button).getByText('!')).toBeTruthy()
    fireEvent.click(button)
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it.each<[string, UpdateStatus, RegExp]>([
    ['downloading', { state: 'downloading', version: VERSION, percent: 42 }, /42/],
    [
      'waiting',
      {
        state: 'error',
        message: 'blocked',
        version: VERSION,
        installBlock: { reason: 'running-instances', instances: [] }
      },
      /waiting/i
    ],
    [
      'external',
      { state: 'available', version: VERSION, changelog: null, externallyManaged: true },
      new RegExp(VERSION.replaceAll('.', '\\.'))
    ]
  ])('expands the update card when %s', (_label, status, name) => {
    renderButton()
    setStatus(status)
    act(() => useAppStore.getState().setUpdateCardCollapsed(true))

    fireEvent.click(updateButton(name))
    expect(useAppStore.getState().updateCardCollapsed).toBe(false)
    expect(download).not.toHaveBeenCalled()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it.each<[string, UpdateStatus, RegExp]>([
    ['checking', { state: 'checking', userInitiated: true }, /checking/i],
    ['installing', { state: 'downloaded', version: VERSION, installing: true }, /update/i]
  ])('is disabled with a spinner while %s', (_label, status, name) => {
    renderButton()
    setStatus(status)

    const button = updateButton(name)
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.querySelector('.animate-spin')).not.toBeNull()
  })

  it('labels a failed update so it can be retried', () => {
    renderButton()
    setStatus({ state: 'error', message: 'download failed', version: VERSION })

    fireEvent.click(updateButton(/failed/i))
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('shows the install error in the tooltip when installing is rejected', async () => {
    quitAndInstall.mockRejectedValueOnce(new Error('disk is full'))
    renderButton()
    setStatus({ state: 'downloaded', version: VERSION })

    const button = updateButton(/ready/i)
    fireEvent.click(button)
    await act(async () => {})
    fireEvent.focus(button)

    expect((await screen.findAllByText(/disk is full/)).length).toBeGreaterThan(0)
  })

  it('does not render in the web client', () => {
    mocks.web = true
    renderButton()
    setStatus({ state: 'available', version: VERSION, changelog: null })

    expect(screen.queryByRole('button')).toBeNull()
  })
})
