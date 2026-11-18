import type React from 'react'
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import { requestUpdateInstall } from '@/lib/update-install-request'
import type { SidebarUpdateButtonModel } from './sidebar-update-button-model'

export type SidebarUpdateButtonActions = {
  onClick: (event: React.MouseEvent) => void
  installError: string | null
}

export function useSidebarUpdateButtonActions(
  model: SidebarUpdateButtonModel
): SidebarUpdateButtonActions {
  const setUpdateCardCollapsed = useAppStore((s) => s.setUpdateCardCollapsed)
  const clearDismissedUpdateVersion = useAppStore((s) => s.clearDismissedUpdateVersion)
  const setUpdateInstallOnDownload = useAppStore((s) => s.setUpdateInstallOnDownload)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    setInstallError(null)
  }, [model.kind])

  const onClick = (event: React.MouseEvent): void => {
    switch (model.action) {
      case 'check':
        void window.api.updater.check(getUpdateCheckClickOptions(event))
        break
      case 'download-and-install':
        // UpdateCard owns the install after download so it survives this button unmounting.
        setUpdateInstallOnDownload(true)
        void window.api.updater.download()
        break
      case 'install':
        setInstallError(null)
        requestUpdateInstall(setInstallError)
        break
      case 'expand-card':
        // A card dismissed for this version stays hidden until the dismissal is cleared.
        clearDismissedUpdateVersion()
        setUpdateCardCollapsed(false)
        break
      case 'none':
        break
    }
  }

  return { onClick, installError }
}
