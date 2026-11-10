import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TopodManagedIdentityError } from '../../managed-server/lifecycle/topod-managed-tunnel-identity'

const mocks = vi.hoisted(() => ({ authenticationRejected: vi.fn() }))

vi.mock('../../../shared/remote-runtime/host-store/runtime-environment-store', () => ({
  resolveEnvironment: () => ({
    id: 'env-1',
    topodDeployment: { sshTargetId: 'ssh-1', sshTargetGeneration: 1, localPort: 1, remotePort: 2 }
  })
}))
vi.mock('./runtime-environment-request-connections', () => ({
  getRuntimeEnvironmentStatusOwner: () => ({
    authenticationRejected: mocks.authenticationRejected
  })
}))
vi.mock('../../managed-server/lifecycle/topod-managed-tunnel', () => ({
  managedTopodPairingFailureStands: vi.fn(),
  recoverRefusedManagedTopodPairing: vi.fn()
}))

const { handleManagedSharedControlRefusal } =
  await import('./runtime-environment-managed-pairing-refusal')

describe('handleManagedSharedControlRefusal', () => {
  beforeEach(() => mocks.authenticationRejected.mockReset())

  it('stops retrying a pairing whose host now serves another server key (#37766)', async () => {
    const refusal = TopodManagedIdentityError.replacedServer(
      { id: 'env-1', name: 'dev box' },
      'a different key'
    )
    await expect(
      handleManagedSharedControlRefusal(
        '/profile',
        'env-1',
        () => Promise.reject(refusal),
        () => true
      )
    ).resolves.toBe('stop')
    expect(mocks.authenticationRejected).toHaveBeenCalledWith(
      refusal.message,
      'topod_server_replaced'
    )
  })
})
