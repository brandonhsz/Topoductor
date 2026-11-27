import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { getTopoCloudAuthConfig, resolveRelay } from './profile-cloud-auth-config'

const SOLO = 'https://relay-solo.example.workers.dev'

describe('relay selection', () => {
  it('uses Topo Cloud’s relay with the account session by default', () => {
    const result = getTopoCloudAuthConfig({}, true)
    expect(result.configured && result.config).toMatchObject({
      relayDirectorUrl: 'https://relay.onorca.dev',
      relayAuthMode: 'cloud-session'
    })
  })

  it('uses a build’s self-hosted relay with host-key auth', () => {
    expect(resolveRelay({}, false, `${SOLO}/`)).toEqual({
      relayDirectorUrl: SOLO,
      relayAuthMode: 'host-key'
    })
  })

  it('lets TOPO_RELAY_URL replace the build relay, with the auth it names', () => {
    expect(resolveRelay({ TOPO_RELAY_URL: 'https://relay.staging.invalid' }, false, SOLO)).toEqual({
      relayDirectorUrl: 'https://relay.staging.invalid',
      relayAuthMode: 'cloud-session'
    })
    expect(
      resolveRelay({ TOPO_RELAY_URL: 'http://127.0.0.1:8789', TOPO_RELAY_AUTH: 'host-key' }, true)
    ).toEqual({ relayDirectorUrl: 'http://127.0.0.1:8789', relayAuthMode: 'host-key' })
  })

  it('ignores a build relay that is not an https origin', () => {
    expect(resolveRelay({}, false, 'http://relay.invalid').relayAuthMode).toBe('cloud-session')
  })
})
