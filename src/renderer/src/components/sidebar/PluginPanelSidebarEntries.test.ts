import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { ActivePluginPanel } from '@/store/plugins/catalog/plugin-contribution-catalog'
import { openPluginPanelFromSidebar, sidebarPluginPanels } from './PluginPanelSidebarEntries'

const initialState = useAppStore.getState()

function panel(id: string, sidebarEntry?: boolean): ActivePluginPanel {
  return {
    id,
    title: id,
    tabKey: `plugin:acme.board/${id}`,
    pluginKey: 'acme.board',
    pluginName: 'Board',
    ...(sidebarEntry === undefined ? {} : { sidebarEntry })
  }
}

afterEach(() => {
  useAppStore.setState(initialState, true)
})

describe('plugin panel sidebar entries', () => {
  it('lists only the panels whose manifest asks for one', () => {
    const listed = sidebarPluginPanels([panel('a'), panel('b', true), panel('c', false)])
    expect(listed.map((entry) => entry.id)).toEqual(['b'])
  })

  it('opens the panel in the right sidebar, leaving a page that hides it', () => {
    useAppStore.setState({ activeView: 'harness', rightSidebarOpen: false })
    openPluginPanelFromSidebar('plugin:acme.board/b')
    const state = useAppStore.getState()
    expect(state.activeView).toBe('terminal')
    expect(state.rightSidebarTab).toBe('plugin:acme.board/b')
    expect(state.rightSidebarOpen).toBe(true)
  })
})
