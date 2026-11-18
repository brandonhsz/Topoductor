import type {
  NotificationDispatchResult,
  NotificationSoundId,
  NotificationSoundRequest
} from './notification-settings-types'

export type AttentionAlertPlan = {
  playSound: boolean
  /** Bundled sound to force when the user's choice ('system') relies on an untrusted banner. */
  soundId: NonNullable<NotificationSoundRequest['soundId']> | null
}

export const FALLBACK_ATTENTION_SOUND_ID = 'two-tone' satisfies NotificationSoundId

const SILENT_PLAN: AttentionAlertPlan = { playSound: false, soundId: null }

const UNTRUSTED_BANNER_REASONS: ReadonlySet<NotificationDispatchResult['reason']> = new Set([
  'blocked-by-system',
  'not-displayed',
  'not-supported'
])

/** Decides whether Topo's own sound must carry an alert the macOS banner may never show. */
export function resolveAttentionAlertPlan(
  result: NotificationDispatchResult | null,
  sound: { customSoundId: string }
): AttentionAlertPlan {
  if (!result) {
    return SILENT_PLAN
  }
  const passedGates = result.delivered || UNTRUSTED_BANNER_REASONS.has(result.reason)
  if (!passedGates) {
    return SILENT_PLAN
  }
  if (sound.customSoundId !== 'system') {
    return { playSound: true, soundId: null }
  }
  // A trusted banner already plays the system sound; anything else needs Topo's own.
  if (result.delivered && result.nativeBannerTrusted === true) {
    return SILENT_PLAN
  }
  return { playSound: true, soundId: FALLBACK_ATTENTION_SOUND_ID }
}
