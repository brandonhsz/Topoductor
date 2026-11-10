import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedTopodOwnerEnvironmentId,
  getManagedTopodFenceEnvironmentId,
  isEphemeralRuntimeSshOwner
} from './managed-topod-ssh-owner'

describe('managed topod SSH fence', () => {
  it('reads the fence from topodFence, never from owner', () => {
    expect(getManagedTopodFenceEnvironmentId({ topodFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      topodFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-topod:old' }
    }
    expect(getManagedTopodFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedTopodFenceEnvironmentId({ ...legacyOnly, topodFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedTopodFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-topod:env-1' }
    expect(getLegacyManagedTopodOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedTopodOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })
})
