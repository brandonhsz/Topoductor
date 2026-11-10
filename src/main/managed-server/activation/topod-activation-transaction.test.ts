import { describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import type * as InstallLock from '../install/remote-install-lock'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn().mockResolvedValue('')
}))
vi.mock('../install/remote-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn().mockResolvedValue(undefined)
}))
import {
  parseTopodActivationTransaction,
  planTopodTransactionRecovery
} from './topod-activation-transaction'
import {
  createTopodActivationTransaction,
  createTopodRollbackTransaction,
  withTopodActivationIncumbentStopped,
  withTopodActivationSnapshot
} from './topod-activation-transaction-transitions'
import { FakeTopodHost, NEW, OLD } from './topod-activation-host-test-harness'
import { withRolledBackVersion } from './topod-activation-record'

const T = new Date('2026-02-02T00:00:00.000Z')
const ID = '7f1c2a7e-6c1b-4a8e-9f0e-0a1b2c3d4e5f'
const before = FakeTopodHost.newRecord()

function activation(): ReturnType<typeof createTopodActivationTransaction> {
  return createTopodActivationTransaction({
    transactionId: ID,
    candidateVersion: '0.3.0+cc01',
    recordBefore: before,
    snapshotDirName: 'pre-0.3.0+cc01-1',
    now: T
  })
}

function rollback(): ReturnType<typeof createTopodRollbackTransaction> {
  return createTopodRollbackTransaction({
    transactionId: ID,
    incumbentVersion: NEW,
    targetVersion: OLD,
    recordBefore: before,
    recordAfter: withRolledBackVersion(before, T),
    rescueDirName: 'rollback-rescue-0.2.0+bb01-1',
    now: T
  })
}

describe('parseTopodActivationTransaction', () => {
  it('rejects a rollback whose versions disagree with its records', () => {
    const raw = JSON.stringify({ ...rollback(), targetVersion: '0.0.9+dd01' })
    expect(parseTopodActivationTransaction(raw)).toMatchObject({ state: 'unreadable' })
  })
})

describe('planTopodTransactionRecovery', () => {
  withTopodActivationSnapshot(withTopodActivationIncumbentStopped(activation(), T), 'captured', T)

  it('refuses when the record matches neither side', () => {
    expect(planTopodTransactionRecovery(activation(), { ...before, previous: null })).toMatchObject(
      {
        action: 'refuse',
        code: 'topod_recovery_activation_record_changed'
      }
    )
  })
})
