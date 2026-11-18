import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import type { SidebarUpdateButtonModel } from './sidebar-update-button-model'

export type SidebarUpdateButtonActions = {
  onPointerDown: (event: React.PointerEvent) => void
  onClick: () => void
  installError: string | null
}

const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

export function useSidebarUpdateButtonActions(
  model: SidebarUpdateButtonModel
): SidebarUpdateButtonActions {
  const setUpdateCardCollapsed = useAppStore((s) => s.setUpdateCardCollapsed)
  const clearDismissedUpdateVersion = useAppStore((s) => s.clearDismissedUpdateVersion)
  const [installError, setInstallError] = useState<string | null>(null)
  const modifiersRef = useRef(NO_MODIFIERS)
  // The card only auto-installs downloads it started, so this button tracks its own.
  const installAfterDownloadRef = useRef(false)

  const install = useCallback((): void => {
    setInstallError(null)
    void window.api.updater.quitAndInstall().catch((error: unknown) => {
      setInstallError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  useEffect(() => {
    if (model.kind === 'ready' && installAfterDownloadRef.current) {
      installAfterDownloadRef.current = false
      install()
    } else if (model.kind === 'idle' || model.kind === 'error' || model.kind === 'checking') {
      installAfterDownloadRef.current = false
    }
  }, [model.kind, install])

  const onPointerDown = (event: React.PointerEvent): void => {
    modifiersRef.current = {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }
  }

  const onClick = (): void => {
    const modifiers = modifiersRef.current
    modifiersRef.current = NO_MODIFIERS
    switch (model.action) {
      case 'check':
        void window.api.updater.check(getUpdateCheckClickOptions(modifiers))
        return
      case 'download-and-install':
        installAfterDownloadRef.current = true
        void window.api.updater.download()
        return
      case 'install':
        install()
        return
      case 'expand-card':
        // A card dismissed for this version stays hidden until the dismissal is cleared.
        clearDismissedUpdateVersion()
        setUpdateCardCollapsed(false)
        break
      case 'none':
        break
    }
  }

  return { onPointerDown, onClick, installError }
}
