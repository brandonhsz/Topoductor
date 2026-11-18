import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'
import {
  notificationOnMock,
  notificationOnceMock,
  resetNotificationDispatchMocks
} from './notifications-test-harness'

vi.mock('electron', async () =>
  (await import('./notifications-test-harness')).createElectronModuleMock()
)

vi.mock('./ui', async () =>
  (await import('./notifications-test-harness')).createTrustedUIRendererModuleMock()
)

import { deliverNativeNotification } from './native-notification-delivery'
import {
  getLastObservedDeliveryOutcome,
  recordNotificationDeliveryOutcome,
  resetNotificationPermissionEvidence
} from './notification-permission-probe'

function emitNotificationEvent(event: string): void {
  const registrations: unknown[][] = [
    ...notificationOnMock.mock.calls,
    ...notificationOnceMock.mock.calls
  ]
  for (const [name, listener] of registrations) {
    if (name === event && typeof listener === 'function') {
      listener()
    }
  }
}

describe('deliverNativeNotification', () => {
  beforeEach(() => {
    resetNotificationDispatchMocks()
    resetNotificationPermissionEvidence()
  })

  it('records a shown everyday banner as delivered, clearing an earlier failure', () => {
    recordNotificationDeliveryOutcome('failed')

    expect(
      deliverNativeNotification(
        { source: 'agent-task-complete', agentState: 'done', worktreeId: 'repo::wt1' },
        { title: 'Claude finished', body: 'Claude finished.' },
        getDefaultNotificationSettings()
      )
    ).toEqual({ delivered: true })
    expect(getLastObservedDeliveryOutcome()).toBe('failed')

    emitNotificationEvent('show')
    expect(getLastObservedDeliveryOutcome()).toBe('delivered')
  })
})
