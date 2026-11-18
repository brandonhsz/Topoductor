// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'

vi.mock('./SidebarUpdateButton', () => ({
  SidebarUpdateButton: () => <button type="button" aria-label="Sidebar update button" />
}))
vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: () => ({ ready: false, coreDoneCount: 0, coreTotal: 0 })
}))

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
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
    value: { updater: { check: vi.fn().mockResolvedValue(undefined) } }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

function renderMenu(): void {
  render(
    <TooltipProvider>
      <SidebarSettingsHelpMenu />
    </TooltipProvider>
  )
}

describe('SidebarSettingsHelpMenu', () => {
  it('places the update button right after Settings and before Help', () => {
    renderMenu()
    const labels = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    const settingsIndex = labels.indexOf('Settings')

    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    expect(labels.slice(settingsIndex, settingsIndex + 3)).toEqual([
      'Settings',
      'Sidebar update button',
      'Help'
    ])
  })

  it('keeps Check for Updates in the Help menu', async () => {
    renderMenu()
    const help = screen.getByRole('button', { name: 'Help' })
    fireEvent.pointerDown(help, { button: 0, ctrlKey: false, pointerType: 'mouse' })

    expect(await screen.findByRole('menuitem', { name: /Check for Updates/ })).toBeTruthy()
  })
})
