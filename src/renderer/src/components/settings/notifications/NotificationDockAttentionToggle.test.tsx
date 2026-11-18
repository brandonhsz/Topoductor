// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { NotificationSettings } from '../../../../../shared/notification-settings-types'
import { matchesSettingsSearch } from '../search/settings-search'
import { NotificationDockAttentionToggle } from './NotificationDockAttentionToggle'
import { getNotificationsPaneSearchEntries } from './notifications-search'

afterEach(() => {
  cleanup()
})

function renderToggle(overrides: Partial<NotificationSettings> = {}) {
  const settings: NotificationSettings = {
    ...getDefaultSettings('/tmp').notifications,
    ...overrides
  }
  const updateSettings = vi.fn<(updates: Partial<GlobalSettings>) => void>()
  render(<NotificationDockAttentionToggle settings={settings} updateSettings={updateSettings} />)
  return { settings, updateSettings }
}

describe('NotificationDockAttentionToggle', () => {
  it('renders a checked switch when notifications and dock attention are on', () => {
    renderToggle({ enabled: true, dockAttention: true })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('renders an unchecked switch when dock attention is off', () => {
    renderToggle({ enabled: true, dockAttention: false })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('renders nothing while notifications are disabled', () => {
    renderToggle({ enabled: false, dockAttention: true })
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('turns dock attention off while keeping the other notification settings', () => {
    const { settings, updateSettings } = renderToggle({
      enabled: true,
      dockAttention: true,
      terminalBell: false,
      customSoundId: 'bong'
    })
    fireEvent.click(screen.getByRole('switch'))
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({
      notifications: { ...settings, dockAttention: false }
    })
  })

  it('turns dock attention back on', () => {
    const { settings, updateSettings } = renderToggle({ enabled: true, dockAttention: false })
    fireEvent.click(screen.getByRole('switch'))
    expect(updateSettings).toHaveBeenCalledWith({
      notifications: { ...settings, dockAttention: true }
    })
  })
})

describe('notifications settings search', () => {
  it.each(['dock', 'bounce'])('finds the dock attention toggle by "%s"', (query) => {
    const entries = getNotificationsPaneSearchEntries()
    expect(matchesSettingsSearch(query, entries)).toBe(true)
  })
})
