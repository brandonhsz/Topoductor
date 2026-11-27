import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { openRemoteDesktopWindow } from '../status-bar/RemoteDesktopStatusAction'
import { RemoteDesktopRoot } from './RemoteDesktopRoot'

/** The remote desktop embedded in the main window's content area. */
export default function RemoteDesktopPage(): React.JSX.Element | null {
  const page = useAppStore((state) => state.remoteDesktopPage)
  const closePage = useAppStore((state) => state.closeRemoteDesktopPage)

  useEffect(() => {
    if (!page) {
      closePage()
    }
  }, [closePage, page])

  if (!page) {
    return null
  }
  return (
    <RemoteDesktopRoot
      key={page.hostId}
      hostId={page.hostId}
      title={page.label}
      embedded
      onClose={closePage}
      onPopOut={() => {
        closePage()
        openRemoteDesktopWindow(page.hostId, page.label)
      }}
    />
  )
}
