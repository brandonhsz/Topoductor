import type { UpdateStatus } from '../../../../shared/update-status-types'
import { clampUpdateDownloadPercent } from '@/lib/update-download-percent'

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

function model(
  kind: SidebarUpdateButtonKind,
  action: SidebarUpdateButtonAction,
  fields: Partial<Pick<SidebarUpdateButtonModel, 'badge' | 'version' | 'percent'>> = {}
): SidebarUpdateButtonModel {
  return {
    kind,
    action,
    badge: fields.badge ?? false,
    version: fields.version ?? null,
    percent: fields.percent ?? null,
    disabled: action === 'none'
  }
}

// Pure projection of UpdateStatus; ignores card dismissal so the badge persists.
export function getSidebarUpdateButtonModel(status: UpdateStatus): SidebarUpdateButtonModel {
  switch (status.state) {
    case 'idle':
    case 'not-available':
      return model('idle', 'check')
    case 'checking':
      return model('checking', 'none')
    case 'available':
      return status.externallyManaged
        ? model('external', 'expand-card', { badge: true, version: status.version })
        : model('available', 'download-and-install', { badge: true, version: status.version })
    case 'downloading':
      return model('downloading', 'expand-card', {
        badge: true,
        version: status.version,
        percent: clampUpdateDownloadPercent(status.percent)
      })
    case 'downloaded':
      return status.installing
        ? model('installing', 'none', { badge: true, version: status.version })
        : model('ready', 'install', { badge: true, version: status.version })
    case 'error':
      // Retry rules (retryable, local builds, signatures, install blocks) live in the card.
      if (status.installBlock) {
        return model('waiting', 'expand-card', { badge: true, version: status.version })
      }
      if (status.recovery?.kind === 'linux-package-install') {
        return model('external', 'expand-card', {
          badge: true,
          version: status.recovery.version
        })
      }
      // The alert icon already signals attention; a "!" badge would double it.
      return model('error', 'expand-card', { version: status.version })
  }
}
