import type React from 'react'
import type { SidebarUpdateButtonModel } from './sidebar-update-button-model'

export type SidebarUpdateButtonActions = {
  onPointerDown: (event: React.PointerEvent) => void
  onClick: () => void
  installError: string | null
}

export function useSidebarUpdateButtonActions(
  _model: SidebarUpdateButtonModel
): SidebarUpdateButtonActions {
  throw new Error('not implemented')
}
