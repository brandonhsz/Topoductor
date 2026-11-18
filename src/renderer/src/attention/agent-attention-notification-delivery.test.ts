import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationDispatchResult } from '../../../shared/notification-settings-types'
import { deliverAgentAttentionNotification } from './agent-attention-notification-delivery'

const { showBlockedToast } = vi.hoisted(() => ({ showBlockedToast: vi.fn() }))
vi.mock('@/lib/blocked-notification-fallback', () => ({
  showBlockedNotificationFallbackToast: showBlockedToast
}))

const dispatch = vi.fn<(request: unknown) => Promise<NotificationDispatchResult>>()
const playSound = vi.fn(async () => ({ played: true }))

beforeEach(() => {
  vi.stubGlobal('window', { api: { notifications: { dispatch, playSound } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function deliver(
  result: NotificationDispatchResult,
  customSoundId: string
): Promise<NotificationDispatchResult | null> {
  dispatch.mockResolvedValueOnce(result)
  let observed: NotificationDispatchResult | null | undefined
  deliverAgentAttentionNotification(
    { source: 'agent-task-complete', agentState: 'blocked' },
    { customSoundId, customSoundVolume: 0.4 },
    (value) => {
      observed = value
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return observed ?? null
}

describe('deliverAgentAttentionNotification fallback sound', () => {
  it('plays the bundled two-tone when macOS blocks the banner and the user relies on the system sound', async () => {
    await deliver({ delivered: false, reason: 'blocked-by-system' }, 'system')

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(playSound).toHaveBeenCalledWith({ volume: 0.4, soundId: 'two-tone' })
  })

  it('still shows the blocked-permission toast alongside the fallback sound', async () => {
    await deliver({ delivered: false, reason: 'blocked-by-system' }, 'system')

    expect(showBlockedToast).toHaveBeenCalledTimes(1)
    expect(playSound).toHaveBeenCalledWith({ volume: 0.4, soundId: 'two-tone' })
  })

  it('plays the bundled two-tone when the banner was not displayed and the user relies on the system sound', async () => {
    await deliver({ delivered: false, reason: 'not-displayed' }, 'system')

    expect(playSound).toHaveBeenCalledWith({ volume: 0.4, soundId: 'two-tone' })
    expect(showBlockedToast).not.toHaveBeenCalled()
  })

  it('plays the bundled two-tone when delivered without a trusted banner and the user relies on the system sound', async () => {
    await deliver({ delivered: true, nativeBannerTrusted: false }, 'system')

    expect(playSound).toHaveBeenCalledWith({ volume: 0.4, soundId: 'two-tone' })
  })

  it('stays silent when the trusted banner already carries the system sound', async () => {
    const observed = await deliver({ delivered: true, nativeBannerTrusted: true }, 'system')

    expect(observed).toEqual({ delivered: true, nativeBannerTrusted: true })
    expect(playSound).not.toHaveBeenCalled()
  })

  it("plays the user's chosen sound without an override when the banner is trusted", async () => {
    await deliver({ delivered: true, nativeBannerTrusted: true }, 'bong')

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(playSound).toHaveBeenCalledWith({ volume: 0.4 })
  })

  it("plays the user's chosen sound without an override when macOS blocks the banner", async () => {
    await deliver({ delivered: false, reason: 'blocked-by-system' }, 'bong')

    expect(playSound).toHaveBeenCalledTimes(1)
    expect(playSound).toHaveBeenCalledWith({ volume: 0.4 })
    expect(showBlockedToast).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['suppressed-focus', 'system'],
    ['suppressed-focus', 'bong'],
    ['cooldown', 'system'],
    ['cooldown', 'bong'],
    ['host-muted', 'system'],
    ['host-muted', 'bong']
  ] as const)(
    'plays no sound and shows no toast when delivery was skipped for %s (%s)',
    async (reason, customSoundId) => {
      const observed = await deliver({ delivered: false, reason }, customSoundId)

      expect(observed).toEqual({ delivered: false, reason })
      expect(playSound).not.toHaveBeenCalled()
      expect(showBlockedToast).not.toHaveBeenCalled()
    }
  )
})
