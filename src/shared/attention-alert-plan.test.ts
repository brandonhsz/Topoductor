import { describe, expect, it } from 'vitest'
import { FALLBACK_ATTENTION_SOUND_ID, resolveAttentionAlertPlan } from './attention-alert-plan'
import type { NotificationDispatchResult, NotificationSoundId } from './notification-settings-types'

type Reason = NonNullable<NotificationDispatchResult['reason']>

const SILENT_REASONS: Reason[] = [
  'disabled',
  'source-disabled',
  'host-muted',
  'suppressed-focus',
  'cooldown',
  'already-read',
  'invalid-request'
]

// Alert passed every gate but the banner cannot be trusted to have been seen or heard.
const UNTRUSTED_BANNER_REASONS: Reason[] = ['blocked-by-system', 'not-displayed', 'not-supported']

const SILENT_PLAN = { playSound: false, soundId: null }

describe('resolveAttentionAlertPlan', () => {
  it('falls back to the two-tone bundled sound', () => {
    expect(FALLBACK_ATTENTION_SOUND_ID).toBe('two-tone')
  })

  it('stays silent without a dispatch result', () => {
    expect(resolveAttentionAlertPlan(null, { customSoundId: 'system' })).toEqual(SILENT_PLAN)
    expect(resolveAttentionAlertPlan(null, { customSoundId: 'bong' })).toEqual(SILENT_PLAN)
  })

  describe.each(SILENT_REASONS)('when a gate rejects the alert (%s)', (reason) => {
    it.each<NotificationSoundId>(['system', 'bong', 'custom'])(
      'stays silent with customSoundId %s',
      (customSoundId) => {
        expect(resolveAttentionAlertPlan({ delivered: false, reason }, { customSoundId })).toEqual(
          SILENT_PLAN
        )
      }
    )
  })

  describe.each(UNTRUSTED_BANNER_REASONS)('when the banner is not shown (%s)', (reason) => {
    it("plays the fallback sound instead of the 'system' banner sound", () => {
      expect(
        resolveAttentionAlertPlan({ delivered: false, reason }, { customSoundId: 'system' })
      ).toEqual({ playSound: true, soundId: FALLBACK_ATTENTION_SOUND_ID })
    })

    it.each<NotificationSoundId>(['bong', 'custom'])(
      "plays the user's own %s sound without overriding it",
      (customSoundId) => {
        expect(resolveAttentionAlertPlan({ delivered: false, reason }, { customSoundId })).toEqual({
          playSound: true,
          soundId: null
        })
      }
    )
  })

  describe('when the banner was delivered', () => {
    it("lets a trusted banner carry the 'system' sound alone", () => {
      expect(
        resolveAttentionAlertPlan(
          { delivered: true, nativeBannerTrusted: true },
          { customSoundId: 'system' }
        )
      ).toEqual(SILENT_PLAN)
    })

    it.each<NotificationDispatchResult>([
      { delivered: true, nativeBannerTrusted: false },
      { delivered: true }
    ])("plays the fallback for 'system' when the banner is untrusted (%o)", (result) => {
      expect(resolveAttentionAlertPlan(result, { customSoundId: 'system' })).toEqual({
        playSound: true,
        soundId: FALLBACK_ATTENTION_SOUND_ID
      })
    })

    it.each<[NotificationDispatchResult, NotificationSoundId]>([
      [{ delivered: true, nativeBannerTrusted: true }, 'bong'],
      [{ delivered: true, nativeBannerTrusted: false }, 'bong'],
      [{ delivered: true, nativeBannerTrusted: true }, 'custom']
    ])("plays the user's own sound (%o, %s)", (result, customSoundId) => {
      expect(resolveAttentionAlertPlan(result, { customSoundId })).toEqual({
        playSound: true,
        soundId: null
      })
    })
  })
})
