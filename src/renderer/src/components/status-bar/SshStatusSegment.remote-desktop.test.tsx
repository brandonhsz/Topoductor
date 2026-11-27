// @vitest-environment happy-dom
import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { SshStatusSegment } from './SshStatusSegment'

const state = {
  sshTargetLabels: new Map([['box', 'Build box']]),
  sshConnectionStates: new Map<string, SshConnectionState>([
    ['box', { targetId: 'box', status: 'connected', error: null, reconnectAttempt: 0 }]
  ]),
  repos: [],
  runtimeEnvironments: [],
  runtimeStatusByEnvironmentId: new Map(),
  settings: null,
  readRuntimeHostStatusSnapshots: vi.fn(async () => undefined),
  hydrateRuntimeEnvironmentStatuses: vi.fn(),
  recordFeatureInteraction: vi.fn(),
  openSettingsTarget: vi.fn(),
  setActiveView: vi.fn(),
  openRemoteDesktopPage: vi.fn()
}

vi.mock('../../store', () => {
  const useAppStore = (selector: (value: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('../../lib/ssh-config-passive-sync', () => ({
  syncSshConfigTargetsPassively: vi.fn(async () => undefined)
}))
vi.mock('@/components/ui/dropdown-menu', () => {
  const content = ({ children }: PropsWithChildren) => <div>{children}</div>
  return {
    DropdownMenu: ({
      open,
      onOpenChange,
      children
    }: PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void }>) => (
      <div>
        <button type="button" onClick={() => onOpenChange(true)}>
          open host menu
        </button>
        {open ? children : null}
      </div>
    ),
    DropdownMenuContent: content,
    DropdownMenuItem: ({ children }: PropsWithChildren) => <div role="menuitem">{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: () => null,
    DropdownMenuSub: content,
    DropdownMenuSubContent: content,
    DropdownMenuSubTrigger: content
  }
})

beforeEach(() => {
  vi.stubGlobal('api', { remoteDesktop: {} })
  state.openRemoteDesktopPage.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the host status menu', () => {
  it('opens a host desktop inside Topo and gets out of its way', () => {
    render(<SshStatusSegment compact={false} iconOnly={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'open host menu' }))

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))

    expect(state.openRemoteDesktopPage).toHaveBeenCalledWith('ssh:box', 'Build box')
    expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull()
  })
})
