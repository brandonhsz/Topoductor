import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

// Notify once per session about blocked OS notifications so completion bursts do not nag.
let shownThisSession = false

export function showBlockedNotificationFallbackToast(): void {
  if (shownThisSession) {
    return
  }
  shownThisSession = true
  toast.warning(
    translate(
      'auto.lib.blocked.notification.fallback.bannersBlocked',
      "macOS is blocking Topo's banners"
    ),
    {
      description: translate(
        'auto.lib.blocked.notification.fallback.soundAndDockInstead',
        'Topo will alert you with sound and the Dock instead.'
      ),
      action: {
        label: translate(
          'auto.components.onboarding.NotificationStep.4f6a1da718',
          'Open System Settings'
        ),
        onClick: () => {
          void window.api.notifications.openSystemSettings()
        }
      }
    }
  )
}
