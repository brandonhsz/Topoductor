// @vitest-environment happy-dom
import type React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
import { UpdateCard } from '../UpdateCard'
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

function renderButton({ withCard = false }: { withCard?: boolean } = {}): {
  hideButton: () => void
} {
  const view = (showButton: boolean): React.JSX.Element => (
    <TooltipProvider>
      {withCard ? <UpdateCard /> : null}
      {showButton ? <SidebarUpdateButton /> : null}
    </TooltipProvider>
  )
  const { rerender } = render(view(true))
  return { hideButton: () => rerender(view(false)) }
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
    value: {
      updater: { check, download, quitAndInstall },
      ui: { set: vi.fn().mockResolvedValue(undefined) }
    }
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
    const modifiers = { altKey: false, ctrlKey: true, metaKey: true, shiftKey: true }

    fireEvent.click(updateButton(/check for updates/i), modifiers)
    expect(check).toHaveBeenCalledWith(getUpdateCheckClickOptions(modifiers))
  })

  it('ignores modifiers from an abandoned pointer press on a later keyboard click', () => {
    renderButton()
    setStatus({ state: 'idle' })
    const button = updateButton(/check for updates/i)

    fireEvent.pointerDown(button, { shiftKey: true, metaKey: true, altKey: true })
    fireEvent.pointerLeave(button)
    fireEvent.click(button)
    expect(check).toHaveBeenCalledWith(
      getUpdateCheckClickOptions({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })
    )
  })

  it('shows a badge and the version when an update is available, even if the card was dismissed', () => {
    renderButton()
    act(() => useAppStore.setState({ dismissedUpdateVersion: VERSION }))
    setStatus({ state: 'available', version: VERSION, changelog: null })

    const button = updateButton(new RegExp(VERSION.replaceAll('.', '\\.')))
    expect(within(button).getByText('!')).toBeTruthy()
  })

  it('downloads then installs exactly once when applying an available update', async () => {
    renderButton({ withCard: true })
    setStatus({ state: 'available', version: VERSION, changelog: null })

    fireEvent.click(updateButton(new RegExp(`Update to Topo v${VERSION.replaceAll('.', '\\.')}`)))
    expect(download).toHaveBeenCalledTimes(1)
    expect(quitAndInstall).not.toHaveBeenCalled()

    setStatus({ state: 'downloading', version: VERSION, percent: 50 })
    setStatus({ state: 'downloaded', version: VERSION })
    setStatus({ state: 'downloaded', version: VERSION })
    await act(async () => {})
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('still installs once when the sidebar closes during the download', async () => {
    const { hideButton } = renderButton({ withCard: true })
    setStatus({ state: 'available', version: VERSION, changelog: null })
    fireEvent.click(updateButton(new RegExp(`Update to Topo v${VERSION.replaceAll('.', '\\.')}`)))

    setStatus({ state: 'downloading', version: VERSION, percent: 50 })
    hideButton()
    setStatus({ state: 'downloaded', version: VERSION })
    await act(async () => {})
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('installs once when the card started the download and the button is also mounted', async () => {
    renderButton({ withCard: true })
    setStatus({ state: 'available', version: VERSION, changelog: null })
    fireEvent.click(screen.getAllByRole('button', { name: /^Update$/ })[0]!)

    setStatus({ state: 'downloading', version: VERSION, percent: 50 })
    setStatus({ state: 'downloaded', version: VERSION })
    await act(async () => {})
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not install a download nobody requested', async () => {
    renderButton({ withCard: true })
    setStatus({ state: 'available', version: VERSION, changelog: null })
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
    [
      'installing',
      { state: 'downloaded', version: VERSION, installing: true },
      /^Preparing update$/
    ]
  ])('is disabled with a spinner while %s', (_label, status, name) => {
    renderButton()
    setStatus(status)

    const button = updateButton(name)
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.querySelector('.animate-spin')).not.toBeNull()
  })

  it.each<[string, UpdateStatus]>([
    ['download error', { state: 'error', message: 'download failed', version: VERSION }],
    [
      'non-retryable install error',
      {
        state: 'error',
        message: 'install failed',
        version: VERSION,
        retryAction: 'install',
        retryable: false
      }
    ],
    ['check error', { state: 'error', message: 'offline' }]
  ])('opens the update card for a %s instead of choosing its own retry', (_label, status) => {
    renderButton()
    setStatus(status)
    act(() => useAppStore.getState().setUpdateCardCollapsed(true))

    const button = updateButton(/^Update failed\. Click for details$/)
    expect(within(button).queryByText('!')).toBeNull()
    fireEvent.click(button)
    expect(useAppStore.getState().updateCardCollapsed).toBe(false)
    expect(download).not.toHaveBeenCalled()
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
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

  it('clears a stale install error once the update status changes', async () => {
    quitAndInstall.mockRejectedValueOnce(new Error('disk is full'))
    renderButton()
    setStatus({ state: 'downloaded', version: VERSION })
    fireEvent.click(updateButton(/ready/i))
    await act(async () => {})

    setStatus({ state: 'downloaded', version: VERSION, installing: true })
    setStatus({ state: 'downloaded', version: VERSION })
    fireEvent.focus(updateButton(/ready/i))
    await act(async () => {})
    expect(screen.queryAllByText(/disk is full/)).toHaveLength(0)
  })

  it('does not render in the web client', () => {
    mocks.web = true
    renderButton()
    setStatus({ state: 'available', version: VERSION, changelog: null })

    expect(screen.queryByRole('button')).toBeNull()
  })
})
