import type { NotificationSoundRequest } from '../../../shared/notification-settings-types'

/** `overrideSoundId` forces a bundled sound when the user's own choice cannot carry the alert. */
export async function playDesktopNotificationSound(
  customSoundId: string | null | undefined,
  customSoundVolume?: number | null,
  overrideSoundId?: NotificationSoundRequest['soundId'] | null
): Promise<boolean> {
  const soundId = overrideSoundId ?? undefined
  if (!soundId && (!customSoundId || customSoundId === 'system')) {
    return false
  }

  try {
    const request: NotificationSoundRequest = { volume: customSoundVolume ?? undefined }
    if (soundId) {
      request.soundId = soundId
    }
    const result = await window.api.notifications.playSound(request)
    // Why: 'deduped' is expected when bursts of notifications coalesce — not a failure.
    if (!result.played && result.reason !== 'deduped') {
      console.warn('Failed to play custom notification sound:', result.reason)
    }
    return result.played
  } catch (err) {
    console.warn('Failed to play custom notification sound:', err)
    return false
  }
}
