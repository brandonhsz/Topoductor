import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getDefaultNotificationSettings } from '../../../../../shared/notification-settings-defaults'
import { NotificationDockAttentionToggle } from './NotificationDockAttentionToggle'

export const on = defineFixture({
  width: 640,
  render: () => (
    <NotificationDockAttentionToggle
      settings={getDefaultNotificationSettings()}
      updateSettings={() => undefined}
    />
  )
})

export const off = defineFixture({
  width: 640,
  render: () => (
    <NotificationDockAttentionToggle
      settings={{ ...getDefaultNotificationSettings(), dockAttention: false }}
      updateSettings={() => undefined}
    />
  )
})
