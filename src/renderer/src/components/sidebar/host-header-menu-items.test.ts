import { describe, expect, it } from 'vitest'
import { buildHostHeaderMenuModel } from './host-header-menu-items'

describe('buildHostHeaderMenuModel remote desktop', () => {
  it('offers remote desktop for a connected SSH host and a runtime server', () => {
    expect(
      buildHostHeaderMenuModel({
        kind: 'ssh',
        health: 'available',
        sshConnected: true,
        remoteDesktopSupported: true
      }).actions
    ).toContain('remote-desktop')
    expect(
      buildHostHeaderMenuModel({
        kind: 'runtime',
        health: 'available',
        remoteDesktopSupported: true
      }).actions
    ).toContain('remote-desktop')
  })

  it('hides remote desktop when the host cannot carry it', () => {
    const hidden = [
      {
        kind: 'ssh' as const,
        health: 'available' as const,
        sshConnected: false,
        remoteDesktopSupported: true
      },
      { kind: 'local' as const, health: 'local' as const, remoteDesktopSupported: true },
      { kind: 'runtime' as const, health: 'available' as const, remoteDesktopSupported: false }
    ]
    for (const input of hidden) {
      expect(buildHostHeaderMenuModel(input).actions).not.toContain('remote-desktop')
    }
  })
})
