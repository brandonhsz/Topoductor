import { describe, expect, it } from 'vitest'
import { canUseMobileRelay } from './mobile-relay-availability'
import type { TopoProfileAuthStatus } from './topo-profiles'

const local: TopoProfileAuthStatus = {
  activeProfileId: 'p',
  configured: true,
  state: 'local',
  persistence: 'none'
}

describe('canUseMobileRelay', () => {
  it('needs a Topo Cloud session for the cloud relay', () => {
    expect(canUseMobileRelay(local)).toBe(false)
    expect(canUseMobileRelay({ ...local, state: 'connected' })).toBe(true)
    expect(canUseMobileRelay(null)).toBe(false)
  })

  it('needs no sign-in for a self-hosted relay', () => {
    expect(canUseMobileRelay({ ...local, relaySelfHosted: true })).toBe(true)
  })
})
