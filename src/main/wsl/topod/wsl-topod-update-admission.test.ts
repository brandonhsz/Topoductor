import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import { recordTopodUpdateFailedThisLaunch } from '../../managed-server/lifecycle/topod-managed-update-failure-memory'
import type { ServeReadiness } from '../../server/serve-readiness'

import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { admitWslTopodUpdate } from './wsl-topod-update-admission'

const { adoptRunningTopodVersion, readTopodActivationRecord } = vi.hoisted(() => ({
  adoptRunningTopodVersion: vi.fn(),
  readTopodActivationRecord: vi.fn()
}))

vi.mock('../../managed-server/activation/topod-running-version-adoption', () => ({
  adoptRunningTopodVersion
}))
vi.mock('../../managed-server/activation/topod-activation-record-store', () => ({
  readTopodActivationRecord
}))

// Mixed versions between this desktop and a WSL distro's topod: they update independently.
const OLDER = '1.5.0+aaaaaaaaaaaa'
const NEWER = '1.6.0+bbbbbbbbbbbb'
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
let hostSeq = 0

function running(version: string, appVersion: string): TopodActivationRecord {
  return {
    schemaVersion: 1,
    active: version,
    previous: null,
    activatedAt: '2026-10-01T00:00:00.000Z',
    snapshot: null,
    activeAppVersion: appVersion
  }
}

function admit(
  record: TopodActivationRecord,
  desktop: { candidateVersion: string; appVersion: string },
  options: { intent?: 'connect' | 'update' | 'force'; host?: { kind: 'wsl'; id: string } } = {}
) {
  return admitWslTopodUpdate({
    slot,
    record,
    ...desktop,
    host: options.host ?? { kind: 'wsl', id: `Ubuntu-${(hostSeq += 1)}` },
    intent: options.intent ?? 'connect'
  })
}

beforeEach(() => {
  adoptRunningTopodVersion.mockReset()
  readTopodActivationRecord.mockReset()
})

describe('WSL topod admission across desktop and host versions', () => {
  describe('an older desktop meets the topod a newer desktop deployed', () => {
    const olderDesktop = { candidateVersion: OLDER, appVersion: '1.5.0' }

    it('keeps the newer topod serving its terminals, with no Update hint', async () => {
      adoptRunningTopodVersion.mockResolvedValue({ version: NEWER, readiness, reprobe: vi.fn() })
      for (const intent of ['connect', 'update'] as const) {
        expect(await admit(running(NEWER, '1.6.0'), olderDesktop, { intent })).toEqual({
          action: 'serve',
          version: NEWER,
          readiness,
          deferredUpdate: null
        })
      }
      expect(adoptRunningTopodVersion).toHaveBeenCalledWith(slot, running(NEWER, '1.6.0'), OLDER)
    })
  })

  describe('a newer desktop meets the topod an older desktop deployed', () => {
    const newerDesktop = { candidateVersion: NEWER, appVersion: '1.6.0' }

    it('keeps the older topod serving after a failed update, and offers Force', async () => {
      const host = { kind: 'wsl' as const, id: 'Ubuntu-failed' }
      recordTopodUpdateFailedThisLaunch(host, { code: 'topod_activation_failed', reason: 'boom' })
      adoptRunningTopodVersion.mockResolvedValue({ version: OLDER, readiness, reprobe: vi.fn() })
      expect(await admit(running(OLDER, '1.5.0'), newerDesktop, { host })).toEqual({
        action: 'serve',
        version: OLDER,
        readiness,
        deferredUpdate: {
          candidateVersion: NEWER,
          code: 'topod_activation_failed',
          reason: 'boom',
          forceable: true
        }
      })
    })
  })
})
