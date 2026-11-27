// @vitest-environment happy-dom
import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeHostStatusRow } from './RuntimeHostStatusRow'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('remote desktop in a host status row', () => {
  it('opens the server desktop from its row', () => {
    vi.stubGlobal('api', { remoteDesktop: {} })
    const open = vi.fn()
    render(<RuntimeHostStatusRow label="Topoductor" state="connected" onOpenRemoteDesktop={open} />)

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))

    expect(open).toHaveBeenCalledTimes(1)
  })

  it('offers no desktop for a server that refused this client', () => {
    vi.stubGlobal('api', { remoteDesktop: {} })
    render(
      <RuntimeHostStatusRow
        label="Topoductor"
        state="connected"
        onOpenRemoteDesktop={vi.fn()}
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
      <RuntimeHostStatusRow label="Topoductor" state="connected" onOpenRemoteDesktop={vi.fn()} />
    )

    expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull()
  })
})
