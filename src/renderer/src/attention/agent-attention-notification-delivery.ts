/** Share delivery, success sound and blocked-permission fallback across surfaces; callers own message content. Main applies banner preferences after mobile fanout, so callers cannot promise a banner. */
import { playDesktopNotificationSound } from '@/lib/desktop-notification-sound'
import { showBlockedNotificationFallbackToast } from '@/lib/blocked-notification-fallback'
import { resolveAttentionAlertPlan } from '../../../shared/attention-alert-plan'
import { reconnectAttention } from './reconnect-attention-chime'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSoundId
} from '../../../shared/notification-settings-types'

export type AgentAttentionNotificationSound = {
  customSoundId: string
  customSoundVolume: number | null
}

export function deliverAgentAttentionNotification(
  request: NotificationDispatchRequest,
  sound: AgentAttentionNotificationSound,
  onResult?: (result: NotificationDispatchResult | null) => void
): void {
  const reconnectCoalesced =
    request.executionHost !== undefined &&
    reconnectAttention.coalesceAlert(request.executionHost, Date.now())
  void window.api.notifications
    .dispatch(reconnectCoalesced ? { ...request, reconnectCoalesced } : request)
    .then((result) => {
      onResult?.(result)
      const plan = resolveAttentionAlertPlan(result, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the plan only distinguishes 'system' from any other id.
        customSoundId: sound.customSoundId as NotificationSoundId
      })
      if (plan.playSound && !reconnectCoalesced) {
        void playDesktopNotificationSound(
          sound.customSoundId,
          sound.customSoundVolume,
          plan.soundId
        )
      }
      // Surface blocked macOS permission in-app rather than silently losing the notification.
      if (result.reason === 'blocked-by-system') {
        showBlockedNotificationFallbackToast()
      }
    })
    .catch((err) => {
      onResult?.(null)
      console.warn('Failed to dispatch notification:', err)
    })
}

/** The sound preferences one delivery reads, defaulted the way the dispatch path always has. */
export function readAgentAttentionNotificationSound(settings: {
  notifications?: { customSoundId?: string; customSoundVolume?: number | null } | undefined
}): AgentAttentionNotificationSound {
  return {
    customSoundId: settings.notifications?.customSoundId ?? 'system',
    customSoundVolume: settings.notifications?.customSoundVolume ?? null
  }
}
