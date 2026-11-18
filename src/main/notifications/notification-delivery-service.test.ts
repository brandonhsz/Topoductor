import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/notification-settings-types'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'

vi.mock('electron', async () =>
  (await import('../ipc/notifications-test-harness')).createElectronModuleMock()
)

import {
  recordNotificationDeliveryOutcome,
  resetNotificationPermissionEvidence
} from '../ipc/notification-permission-probe'
import { createNotificationDeliveryService } from './notification-delivery-service'

type AuthorizationStatus = 'authorized' | 'denied' | 'not-determined' | 'unknown' | null
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
    wasRead?: boolean
    supported?: boolean
  } = {}
) {
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
    recordDeliveryOutcome: vi.fn(),
    deliverNative,
    platform: options.platform ?? 'darwin',
    now: () => 1_000_000,
    wasRead: () => options.wasRead ?? false,
    requestDockAttention
  }
  const service = createNotificationDeliveryService(deps)
  const dispatch = async (request: NotificationDispatchRequest) => service.dispatch(request)
  return { dispatch, requestDockAttention, deliverNative }
}

beforeEach(() => {
  resetNotificationPermissionEvidence()
})

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

  it('is not true off macOS, where no authorization is read', async () => {
    const { dispatch } = setup({ platform: 'linux', authorization: 'authorized' })
    const result = await dispatch(REQUEST)
    expect(result.delivered).toBe(true)
    expect(result.nativeBannerTrusted).not.toBe(true)
  })
})

describe('blocked-by-system after an observed failure', () => {
  it.each<AuthorizationStatus>(['unknown', null])(
    'skips the banner once macOS rejected one and authorization is %s',
    async (authorization) => {
      recordNotificationDeliveryOutcome('failed')
      const { dispatch, deliverNative } = setup({ authorization })
      await expect(dispatch(REQUEST)).resolves.toEqual({
        delivered: false,
        reason: 'blocked-by-system'
      })
      expect(deliverNative).not.toHaveBeenCalled()
    }
  )

  it('still delivers a trusted banner when authorization is confirmed', async () => {
    recordNotificationDeliveryOutcome('failed')
    const { dispatch, deliverNative } = setup({ authorization: 'authorized' })
    await expect(dispatch(REQUEST)).resolves.toEqual({
      delivered: true,
      nativeBannerTrusted: true
    })
    expect(deliverNative).toHaveBeenCalledTimes(1)
  })

  it('delivers normally when the last observed outcome was delivered', async () => {
    recordNotificationDeliveryOutcome('delivered')
    const { dispatch, deliverNative } = setup({ authorization: 'unknown' })
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

  it('is silent off macOS, where the banner is never trusted', async () => {
    const { dispatch, deliverNative } = setup({ platform: 'linux' })
    await dispatch(REQUEST)
    expect(deliverNative.mock.calls[0]?.[1].silent).toBe(true)
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

  it('is not requested when dockAttention is off, while the banner still goes out', async () => {
    const { dispatch, requestDockAttention, deliverNative } = setup({
      authorization: 'authorized',
      settings: { dockAttention: false }
    })
    await expect(dispatch(REQUEST)).resolves.toMatchObject({ delivered: true })
    expect(requestDockAttention).not.toHaveBeenCalled()
    expect(deliverNative).toHaveBeenCalledTimes(1)
  })
})
