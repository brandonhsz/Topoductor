import type { NotificationDispatchResult, NotificationSoundId } from './notification-settings-types'

export type AttentionAlertPlan = {
  playSound: boolean
  /** Bundled sound to force when the user's choice ('system') relies on an untrusted banner. */
  soundId: NotificationSoundId | null
}

export const FALLBACK_ATTENTION_SOUND_ID = 'two-tone' satisfies NotificationSoundId

/** Decides whether Topo's own sound must carry an alert the macOS banner may never show. */
export function resolveAttentionAlertPlan(
  result: NotificationDispatchResult | null,
  sound: { customSoundId: NotificationSoundId }
): AttentionAlertPlan {
  throw new Error(
    `resolveAttentionAlertPlan not implemented: ${String(result?.reason)} ${sound.customSoundId}`
  )
}
