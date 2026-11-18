import type { UpdateStatus } from '../../../../shared/update-status-types'

export type SidebarUpdateButtonKind =
  | 'idle'
  | 'checking'
  | 'available'
  | 'external'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'waiting'
  | 'error'

export type SidebarUpdateButtonAction =
  | 'check'
  | 'download-and-install'
  | 'install'
  | 'expand-card'
  | 'none'

export type SidebarUpdateButtonModel = {
  kind: SidebarUpdateButtonKind
  badge: boolean
  version: string | null
  percent: number | null
  action: SidebarUpdateButtonAction
  disabled: boolean
}

// Pure projection of UpdateStatus; ignores card dismissal so the badge persists.
export function getSidebarUpdateButtonModel(_status: UpdateStatus): SidebarUpdateButtonModel {
  throw new Error('not implemented')
}
