import { useTranslate } from '@/i18n/use-translate'
import type { RemoteDesktopHostId } from '../../../../shared/remote-desktop/remote-desktop-contract'

export function openRemoteDesktopWindow(hostId: RemoteDesktopHostId, label: string): void {
  void window.api?.remoteDesktop?.openWindow(hostId, label)
}

/** Web and mobile clients have no remote desktop bridge. */
export function isRemoteDesktopAvailable(): boolean {
  return window.api?.remoteDesktop !== undefined
}

/** Text action beside a host's Connect/Disconnect, matching its sibling buttons. */
export function RemoteDesktopStatusAction({
  hostId,
  label,
  insideMenuTrigger = false
}: {
  hostId: RemoteDesktopHostId
  label: string
  /** A submenu trigger is already interactive, so the action renders as a span there. */
  insideMenuTrigger?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!isRemoteDesktopAvailable()) {
    return null
  }
  const text = t('remoteDesktop.statusAction', 'Desktop')
  const handlers = {
    onPointerMove: (event: React.PointerEvent) => event.stopPropagation(),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      openRemoteDesktopWindow(hostId, label)
    }
  }
  const className =
    'shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/70 hover:text-foreground'
  const title = t('remoteDesktop.open', 'Open remote desktop')
  return insideMenuTrigger ? (
    <span aria-hidden="true" title={title} className={className} {...handlers}>
      {text}
    </span>
  ) : (
    <button type="button" title={title} className={className} {...handlers}>
      {text}
    </button>
  )
}
