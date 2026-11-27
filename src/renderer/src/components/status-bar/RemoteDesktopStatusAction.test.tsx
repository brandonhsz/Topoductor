// @vitest-environment happy-dom
import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeHostStatusRow } from './RuntimeHostStatusRow'

vi.mock('@/components/ui/dropdown-menu', () => {
  const content = ({ children }: PropsWithChildren) => <div>{children}</div>
  return {
    DropdownMenuItem: ({ children, onSelect }: PropsWithChildren<{ onSelect?: () => void }>) => (
      <div role="menuitem" onClick={onSelect}>
        {children}
      </div>
    ),
    DropdownMenuSub: content,
    DropdownMenuSubContent: content,
    DropdownMenuSubTrigger: content
  }
})

function stubRemoteDesktopBridge(): ReturnType<typeof vi.fn> {
  const openWindow = vi.fn(async () => undefined)
  vi.stubGlobal('api', { remoteDesktop: { openWindow } })
  return openWindow
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('remote desktop in the host status menu', () => {
  it('opens the server desktop from its status row', () => {
    const openWindow = stubRemoteDesktopBridge()
    render(
      <RuntimeHostStatusRow
        label="Topoductor"
        state="connected"
        remoteDesktopHostId="runtime:env-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))

    expect(openWindow).toHaveBeenCalledWith('runtime:env-1', 'Topoductor')
  })

  it('offers no desktop for a server that refused this client', () => {
    stubRemoteDesktopBridge()
    render(
      <RuntimeHostStatusRow
        label="Topoductor"
        state="connected"
        remoteDesktopHostId="runtime:env-1"
        blocked={{
          label: 'Access revoked',
          summary: 'Access revoked',
          explanation: 'The server no longer trusts this device.',
          recovery: null
        }}
      />
    )

    expect(screen.queryByText('Desktop')).toBeNull()
  })

  it('offers no desktop on clients without the bridge', () => {
    vi.stubGlobal('api', {})
    render(
      <RuntimeHostStatusRow
        label="Topoductor"
        state="connected"
        remoteDesktopHostId="runtime:env-1"
      />
    )

    expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull()
  })
})
