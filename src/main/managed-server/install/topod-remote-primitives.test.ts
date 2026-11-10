import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn(),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error && error.message === 'channel lost'
}))

vi.mock('../../ssh/remote-host/ssh-remote-platform-detection', () => ({
  detectRemoteHostPlatform: vi.fn()
}))
vi.mock('../host-state/topod-windows-host-preparation', () => ({
  prepareWindowsTopodHost: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { parseTopodReadinessOutput } from './topod-remote-launch'

const mockExec = vi.mocked(execCommand)
getRemoteHostPlatform('linux-x64')
getRemoteHostPlatform('win32-x64')
Object.create(null)

beforeEach(() => {
  mockExec.mockReset()
})

describe('readiness parsing bounds', () => {
  it('waits on a half-written last line but rejects a finished invalid one', () => {
    expect(parseTopodReadinessOutput('{"type":"topo_ser')).toEqual({ state: 'pending' })
    expect(parseTopodReadinessOutput('{"type":"topo_ser\n')).toMatchObject({
      state: 'malformed'
    })
  })
})
