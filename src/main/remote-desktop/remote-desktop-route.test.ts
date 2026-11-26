import { describe, expect, it } from 'vitest'
import type { KnownRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveRemoteDesktopRoute } from './remote-desktop-route'

function runtimeEnvironment(
  endpoint: string,
  extra: Partial<KnownRuntimeEnvironment> = {}
): KnownRuntimeEnvironment {
  const environment: KnownRuntimeEnvironment = {
    id: 'env-1',
    name: 'Server',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    preferredEndpointId: 'ws-1',
    endpoints: [
      {
        id: 'ws-1',
        kind: 'websocket',
        label: 'WebSocket',
        endpoint,
        deviceToken: 'token',
        publicKeyB64: 'key'
      }
    ],
    ...extra
  }
  return environment
}

function resolveWith(environment: KnownRuntimeEnvironment | null) {
  return resolveRemoteDesktopRoute('runtime:env-1', {
    resolveRuntimeEnvironment: () => environment
  })
}

describe('resolveRemoteDesktopRoute', () => {
  it('tunnels SSH hosts through their target', () => {
    expect(
      resolveRemoteDesktopRoute('ssh:my-box', { resolveRuntimeEnvironment: () => null })
    ).toEqual({ ok: true, route: { kind: 'ssh', targetId: 'my-box' } })
  })

  it('connects directly to a runtime server on Tailscale', () => {
    expect(resolveWith(runtimeEnvironment('ws://100.122.131.57:6768'))).toEqual({
      ok: true,
      route: { kind: 'direct', host: '100.122.131.57' }
    })
  })

  it('reuses the SSH tunnel a runtime server is reached through', () => {
    const environment = runtimeEnvironment('ws://127.0.0.1:41000', {
      sshAccess: {
        sshTargetId: 'box',
        sshTargetGeneration: 1,
        localPort: 41000,
        remotePort: 6768,
        endpointId: 'ws-1',
        previousPreferredEndpointId: 'ws-1'
      }
    })
    expect(resolveWith(environment)).toEqual({
      ok: true,
      route: { kind: 'ssh', targetId: 'box' }
    })
  })

  it('refuses to send VNC over a public address', () => {
    const result = resolveWith(runtimeEnvironment('wss://example.com:6768'))
    expect(result.ok ? null : result.error.code).toBe('host_not_private')
  })

  it('reports an unknown runtime server as unsupported', () => {
    const result = resolveWith(null)
    expect(result.ok ? null : result.error.code).toBe('host_unsupported')
  })
})
