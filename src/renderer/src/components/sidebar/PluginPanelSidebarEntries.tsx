import React from 'react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'
import { useTranslate } from '@/i18n/use-translate'
import {
  usePluginPanels,
  type ActivePluginPanel
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panels/plugin-panel-activity-items'

export function sidebarPluginPanels(panels: readonly ActivePluginPanel[]): ActivePluginPanel[] {
  return panels.filter((panel) => panel.sidebarEntry === true)
}

/** Plugin panels live in the right sidebar, which only paints over a workspace view. */
export function openPluginPanelFromSidebar(tabKey: ActivePluginPanel['tabKey']): void {
  const state = useAppStore.getState()
  if (!canShowRightSidebarForView(state.activeView)) {
    state.setActiveView('terminal')
  }
  state.setRightSidebarTab(tabKey)
  state.setRightSidebarOpen(true)
}

/** Panels whose manifest asks for `sidebarEntry`, listed below Harness. */
export function PluginPanelSidebarEntries(): React.JSX.Element | null {
  const t = useTranslate()
  const panels = sidebarPluginPanels(usePluginPanels())
  const hasWorkspace = useAppStore((state) => state.activeWorktreeId !== null)
  const openTabKey = useAppStore((state) =>
    state.rightSidebarOpen && canShowRightSidebarForView(state.activeView)
      ? state.rightSidebarTab
      : null
  )
  if (panels.length === 0) {
    return null
  }
  return (
    <>
      {panels.map((panel) => {
        const active = openTabKey === panel.tabKey
        const Icon = resolvePluginPanelIcon(panel.icon)
        return (
          <button
            key={panel.tabKey}
            type="button"
            disabled={!hasWorkspace}
            title={
              hasWorkspace
                ? panel.pluginName
                : t(
                    'auto.components.settings.PluginContributionActionPanel.needsWorkspace',
                    'Needs an open workspace'
                  )
            }
            onClick={() => openPluginPanelFromSidebar(panel.tabKey)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors disabled:opacity-50',
              active
                ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
            )}
          >
            <Icon
              size={16}
              className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
            />
            {/* Manifest titles are plugin-owned and render without app-catalog translation. */}
            <span className="flex-1 truncate">{panel.title}</span>
          </button>
        )
      })}
    </>
  )
}
