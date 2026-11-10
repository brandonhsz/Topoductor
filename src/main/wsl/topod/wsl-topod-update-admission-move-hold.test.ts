import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOPOD_UPDATE_WSL_MOVE_RUNNING_CODE } from '../../../shared/wsl-host-types'
import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { admitWslTopodUpdate } from './wsl-topod-update-admission'

const { adoptRunningTopodVersion } = vi.hoisted(() => ({ adoptRunningTopodVersion: vi.fn() }))

vi.mock('../../managed-server/activation/topod-running-version-adoption', () => ({
  adoptRunningTopodVersion
}))
vi.mock('../../managed-server/activation/topod-activation-record-store', () => ({
  readTopodActivationRecord: vi.fn()
}))

const RUNNING = '1.5.0+aaaaaaaaaaaa'
const BUNDLED = '1.6.0+bbbbbbbbbbbb'
const slot: TopodSlotOptions = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  conn: {} as TopodSlotOptions['conn'],
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  nodePath: '',
  userDataDir: '/home/u/.topo',
  bindHost: '127.0.0.1',
  port: 6768
}
const readiness: ServeReadiness = {
  runtimeId: 'wsl-runtime',
  boundEndpoint: '127.0.0.1:6768',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: '' }
}
const record: TopodActivationRecord = {
  schemaVersion: 1,
  active: RUNNING,
  previous: null,
  activatedAt: '2026-10-01T00:00:00.000Z',
  snapshot: null,
  activeAppVersion: '1.5.0'
}
let hostSeq = 0

function admit(intent: 'connect' | 'update' | 'force', moveRunning: boolean) {
  return admitWslTopodUpdate({
    slot,
    record,
    candidateVersion: BUNDLED,
    appVersion: '1.6.0',
    host: { kind: 'wsl', id: `Ubuntu-${(hostSeq += 1)}` },
    intent,
    moveRunning
  })
}

beforeEach(() => {
  adoptRunningTopodVersion.mockReset()
  adoptRunningTopodVersion.mockResolvedValue({ version: RUNNING, readiness, reprobe: vi.fn() })
})

describe('a WSL topod update while a project moves onto the host', () => {
  it.each(['connect', 'update', 'force'] as const)(
    'keeps the running server for the move on %s, and says the update waits for it',
    async (intent) => {
      expect(await admit(intent, true)).toEqual({
        action: 'serve',
        version: RUNNING,
        readiness,
        deferredUpdate: {
          candidateVersion: BUNDLED,
          code: TOPOD_UPDATE_WSL_MOVE_RUNNING_CODE,
          reason: expect.stringContaining('once the move finishes'),
          forceable: false
        }
      })
    }
  )

  it('updates as before once no move runs', async () => {
    expect(await admit('connect', false)).toEqual({ action: 'deploy', record })
    expect(adoptRunningTopodVersion).not.toHaveBeenCalled()
  })
})
