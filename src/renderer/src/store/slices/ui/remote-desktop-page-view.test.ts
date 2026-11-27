import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { sanitizeHydratedActiveView } from './ui-slice-hydration-sanitizers'

const initialState = useAppStore.getState()

afterEach(() => {
  useAppStore.setState(initialState, true)
})

describe('remote desktop page view', () => {
  it('shows a host desktop and returns to the view it replaced', () => {
    useAppStore.setState({ activeView: 'tasks' })

    useAppStore.getState().openRemoteDesktopPage('runtime:env-1', 'Topoductor')
    expect(useAppStore.getState().activeView).toBe('remote-desktop')
    expect(useAppStore.getState().remoteDesktopPage).toEqual({
      hostId: 'runtime:env-1',
      label: 'Topoductor'
    })

    useAppStore.getState().openRemoteDesktopPage('ssh:box', 'Box')
    useAppStore.getState().closeRemoteDesktopPage()
    expect(useAppStore.getState().activeView).toBe('tasks')
    expect(useAppStore.getState().remoteDesktopPage).toBeNull()
  })

  it('lands on the terminal when a restart restores the desktop view', () => {
    expect(sanitizeHydratedActiveView('remote-desktop')).toBe('terminal')
  })
})
