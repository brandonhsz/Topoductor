import { AppWindow, Dock } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { NotificationSettings } from '../../../../../shared/notification-settings-types'
import { useTranslate } from '@/i18n/use-translate'
import { isMacUserAgent } from '@/lib/user-agent-platform'
import { NotificationSettingToggle } from './NotificationSettingToggle'

type NotificationDockAttentionToggleProps = {
  settings: NotificationSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function NotificationDockAttentionToggle({
  settings,
  updateSettings
}: NotificationDockAttentionToggleProps): React.JSX.Element | null {
  const t = useTranslate()
  if (!settings.enabled) {
    return null
  }
  const isMac = isMacUserAgent()
  return (
    <NotificationSettingToggle
      icon={isMac ? <Dock className="size-4" /> : <AppWindow className="size-4" />}
      label={
        isMac
          ? t('auto.components.settings.NotificationsPane.dockAttentionMac', 'Bounce Dock Icon')
          : t(
              'auto.components.settings.NotificationsPane.dockAttentionWindow',
              'Flash Taskbar or Window'
            )
      }
      description={
        isMac
          ? t(
              'auto.components.settings.NotificationsPane.dockAttentionMacDescription',
              'Bounce the Dock icon and show the pending count when an agent needs you, even if macOS blocks banners.'
            )
          : t(
              'auto.components.settings.NotificationsPane.dockAttentionWindowDescription',
              'Flash the taskbar icon or window when an agent needs you.'
            )
      }
      checked={settings.dockAttention}
      onToggle={() =>
        void updateSettings({
          notifications: { ...settings, dockAttention: !settings.dockAttention }
        })
      }
    />
  )
}
