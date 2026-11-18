import { describe, expect, it, vi } from 'vitest'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/notification-settings-types'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'

vi.mock('electron', async () =>
  (await import('../ipc/notifications-test-harness')).createElectronModuleMock()
)

import { createNotificationDeliveryService } from './notification-delivery-service'

type AuthorizationStatus = 'authorized' | 'denied' | 'not-determined' | 'unknown' | null
type DeliveryOutcome = 'delivered' | 'failed'
type BannerOptions = { title: string; body: string; silent?: boolean }

const REQUEST: NotificationDispatchRequest = {
  source: 'agent-task-complete',
  agentState: 'waiting',
  worktreeId: 'repo-1::/tmp/wt-1',
  worktreeLabel: 'wt-1'
}

function setup(
  options: {
    platform?: NodeJS.Platform
    authorization?: AuthorizationStatus
    settings?: Partial<NotificationSettings>
    windowFocused?: boolean
    wasRead?: boolean | (() => boolean)
    supported?: boolean
    lastOutcome?: DeliveryOutcome
  } = {}
) {
  let lastOutcome: DeliveryOutcome | null = options.lastOutcome ?? null
  const wasRead = options.wasRead
  const settings = { ...getDefaultNotificationSettings(), ...options.settings }
  const requestDockAttention = vi.fn((): void => {})
  const deliverNative = vi.fn(
    (
      _request: NotificationDispatchRequest,
      _options: BannerOptions,
      _settings: NotificationSettings
    ): NotificationDispatchResult => ({ delivered: true })
  )
  const window = { isFocused: () => options.windowFocused ?? false }
  const deps = {
    readNotificationSettings: () => settings,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dispatch only reads isFocused.
    findActiveWindow: () => window as unknown as Electron.BrowserWindow,
    isWindowVisible: () => true,
    setTrayAttention: vi.fn(),
    isNotificationSupported: () => options.supported ?? true,
    dispatchMobileNotification: null,
    readAuthorizationStatus: vi.fn((): Promise<AuthorizationStatus> =>
      Promise.resolve(options.authorization ?? null)
    ),
    recordDeliveryOutcome: (outcome: DeliveryOutcome) => {
      lastOutcome = outcome
    },
    readLastDeliveryOutcome: () => lastOutcome,
    deliverNative,
    platform: options.platform ?? 'darwin',
    now: () => 1_000_000,
    wasRead: () => (typeof wasRead === 'function' ? wasRead() : (wasRead ?? false)),
    requestDockAttention
  }
  const service = createNotificationDeliveryService(deps)
  const dispatch = async (request: NotificationDispatchRequest) => service.dispatch(request)
  const recordOutcome = (outcome: DeliveryOutcome) => {
    lastOutcome = outcome
  }
  return { dispatch, requestDockAttention, deliverNative, recordOutcome }
}

describe('nativeBannerTrusted', () => {
  it('is true when macOS confirms authorization', async () => {
    const { dispatch } = setup({ authorization: 'authorized' })
    await expect(dispatch(REQUEST)).resolves.toEqual({
      delivered: true,
      nativeBannerTrusted: true
    })
  })

  it.each<AuthorizationStatus>(['unknown', null])(
    'is not true when authorization is %s',
    async (authorization) => {
      const { dispatch } = setup({ authorization })
      const result = await dispatch(REQUEST)
      expect(result.delivered).toBe(true)
      expect(result.nativeBannerTrusted).not.toBe(true)
    }
  )

  it.each<NodeJS.Platform>(['win32', 'linux'])(
    'is true on %s, where a supported banner carries its own sound',
    async (platform) => {
      const { dispatch } = setup({ platform })
      await expect(dispatch(REQUEST)).resolves.toEqual({
        delivered: true,
        nativeBannerTrusted: true
      })
    }
  )
})

describe('blocked-by-system after an observed failure', () => {
  it.each<AuthorizationStatus>(['unknown', null])(
    'reports blocked but still attempts a silent banner when authorization is %s',
    async (authorization) => {
      const { dispatch, deliverNative } = setup({ authorization, lastOutcome: 'failed' })
      await expect(dispatch(REQUEST)).resolves.toEqual({
        delivered: false,
        reason: 'blocked-by-system'
      })
      expect(deliverNative).toHaveBeenCalledTimes(1)
      expect(deliverNative.mock.calls[0]?.[1].silent).toBe(true)
    }
  )

  it('stops reporting blocked once a later banner is delivered', async () => {
    const { dispatch, recordOutcome } = setup({ authorization: 'unknown', lastOutcome: 'failed' })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ reason: 'blocked-by-system' })
    recordOutcome('delivered')
    await expect(dispatch({ ...REQUEST, worktreeId: 'repo-1::/tmp/wt-2' })).resolves.toMatchObject({
      delivered: true
    })
  })

  it('still delivers a trusted banner when authorization is confirmed', async () => {
    const { dispatch, deliverNative } = setup({
      authorization: 'authorized',
      lastOutcome: 'failed'
    })
    await expect(dispatch(REQUEST)).resolves.toEqual({
      delivered: true,
      nativeBannerTrusted: true
    })
    expect(deliverNative).toHaveBeenCalledTimes(1)
  })

  it('delivers normally when the last observed outcome was delivered', async () => {
    const { dispatch, deliverNative } = setup({
      authorization: 'unknown',
      lastOutcome: 'delivered'
    })
    const result = await dispatch(REQUEST)
    expect(result.delivered).toBe(true)
    expect(deliverNative).toHaveBeenCalledTimes(1)
  })
})

describe('banner sound', () => {
  it.each<AuthorizationStatus>(['unknown', null])(
    'is silent when the banner is untrusted (authorization %s)',
    async (authorization) => {
      const { dispatch, deliverNative } = setup({ authorization })
      await dispatch(REQUEST)
      expect(deliverNative.mock.calls[0]?.[1].silent).toBe(true)
    }
  )

  it.each<NodeJS.Platform>(['win32', 'linux'])('keeps the system sound on %s', async (platform) => {
    const { dispatch, deliverNative } = setup({ platform })
    await dispatch(REQUEST)
    expect(deliverNative.mock.calls[0]?.[1].silent).not.toBe(true)
  })

  it('keeps the system sound on a trusted banner', async () => {
    const { dispatch, deliverNative } = setup({ authorization: 'authorized' })
    await dispatch(REQUEST)
    expect(deliverNative.mock.calls[0]?.[1].silent).not.toBe(true)
  })
})

describe('requestDockAttention', () => {
  it('is requested once, before the banner, when every gate passes', async () => {
    const { dispatch, requestDockAttention, deliverNative } = setup({ authorization: 'authorized' })
    await dispatch(REQUEST)
    expect(requestDockAttention).toHaveBeenCalledTimes(1)
    expect(requestDockAttention.mock.invocationCallOrder[0]).toBeLessThan(
      deliverNative.mock.invocationCallOrder[0]
    )
  })

  it('is requested even when macOS blocks the banner', async () => {
    const { dispatch, requestDockAttention } = setup({ authorization: 'denied' })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({
      reason: 'blocked-by-system'
    })
    expect(requestDockAttention).toHaveBeenCalledTimes(1)
  })

  it('is requested even when native notifications are unsupported', async () => {
    const { dispatch, requestDockAttention } = setup({ supported: false })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ reason: 'not-supported' })
    expect(requestDockAttention).toHaveBeenCalledTimes(1)
  })

  it('is requested once per alert and not again inside the cooldown', async () => {
    const { dispatch, requestDockAttention } = setup({ authorization: 'authorized' })
    await dispatch(REQUEST)
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ reason: 'cooldown' })
    expect(requestDockAttention).toHaveBeenCalledTimes(1)
  })

  it.each<[string, Parameters<typeof setup>[0], NotificationDispatchRequest, string]>([
    ['disabled', { settings: { enabled: false } }, REQUEST, 'disabled'],
    ['source-disabled', { settings: { agentNeedsInput: false } }, REQUEST, 'source-disabled'],
    [
      'host-muted',
      { settings: { mutedNotificationSourceIds: ['ssh:box'] } },
      { ...REQUEST, notificationSourceId: 'ssh:box' },
      'host-muted'
    ],
    [
      'suppressed-focus',
      { windowFocused: true },
      { ...REQUEST, isActiveWorktree: true },
      'suppressed-focus'
    ],
    ['already-read', { wasRead: true }, REQUEST, 'already-read']
  ])('is not requested when %s', async (_name, options, request, reason) => {
    const { dispatch, requestDockAttention } = setup({ authorization: 'authorized', ...options })
    await expect(dispatch(request)).resolves.toMatchObject({ reason })
    expect(requestDockAttention).not.toHaveBeenCalled()
  })

  it('is not requested when the alert is read while macOS authorization is read', async () => {
    let reads = 0
    const { dispatch, requestDockAttention, deliverNative } = setup({
      authorization: 'authorized',
      wasRead: () => ++reads > 1
    })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ reason: 'already-read' })
    expect(requestDockAttention).not.toHaveBeenCalled()
    expect(deliverNative).not.toHaveBeenCalled()
  })

  it('is not requested when dockAttention is off, while the banner still goes out', async () => {
    const { dispatch, requestDockAttention, deliverNative } = setup({
      authorization: 'authorized',
      settings: { dockAttention: false }
    })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ delivered: true })
    expect(requestDockAttention).not.toHaveBeenCalled()
    expect(deliverNative).toHaveBeenCalledTimes(1)
  })

  it('is not requested for a reconnect burst member, whose banner also stays silent', async () => {
    const { dispatch, requestDockAttention, deliverNative } = setup({ authorization: 'authorized' })
    await expect(dispatch({ ...REQUEST, reconnectCoalesced: true })).resolves.toMatchObject({
      delivered: true
    })
    expect(requestDockAttention).not.toHaveBeenCalled()
    expect(deliverNative.mock.calls[0]?.[1].silent).toBe(true)
  })
})
