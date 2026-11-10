import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'

import {
  moveManagedTopodLocalPort,
  recordManagedTopodMigration,
  refreshManagedTopodPairing
} from '../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'

import { topodMigrationCutoverFixture } from '../migration/cutover/testing/topod-migration-cutover-fixture'
import { writeTopodMigrationSourceCutover } from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  createManagedLifecycleHarness,
  MANAGED_LOCAL_PORT,
  MANAGED_PREVIOUS_VERSION,
  MANAGED_VERSION,
  managedReadiness
} from './topod-managed-lifecycle-test-fixture'

const mocks = vi.hoisted(() => {
  const state: { store: unknown } = { store: null }
  return {
    state,
    resolveContext: vi.fn(),
    census: vi.fn(),
    deploy: vi.fn(),
    rollback: vi.fn(),
    recover: vi.fn(),
    probe: vi.fn(),
    buildHash: vi.fn(),
    ensureTunnel: vi.fn(),
    rebuildTunnel: vi.fn(),
    wake: vi.fn(),
    pendingMigration: vi.fn()
  }
})

vi.mock('../../ssh/targets/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ connect: async () => ({}) }),
  getSshTargetRegistryStore: () => mocks.state.store
}))
vi.mock('../install/topod-remote-context', () => ({
  resolveTopodRemoteContext: mocks.resolveContext
}))
vi.mock('./topod-terminal-census-client', () => ({ collectManagedTerminalCensus: mocks.census }))
vi.mock('../install/topod-remote-deploy', () => ({ deployTopod: mocks.deploy }))
vi.mock('../install/topod-remote-rollback', () => ({
  rollbackTopod: mocks.rollback
}))
vi.mock('../activation/topod-activation-recovery', () => ({
  recoverInterruptedTopodActivation: mocks.recover
}))
vi.mock('../activation/topod-active-readiness', () => ({ probeActiveTopodReadiness: mocks.probe }))
vi.mock('../install/topod-remote-build-hash', () => ({
  readRemoteTopodBuildHash: mocks.buildHash
}))
vi.mock('../../topod/topod-artifact-materializer', () => ({
  materializeTopodArtifact: async () => '/local/topod'
}))
vi.mock('../install/topod-local-build-hash', () => ({
  computeLocalTopodBuildHash: () => 'local-hash'
}))
vi.mock('./topod-managed-tunnel', () => ({
  ensureTopodManagedTunnel: mocks.ensureTunnel,
  rebuildTopodManagedTunnel: mocks.rebuildTunnel
}))
vi.mock('./topod-managed-wake', () => ({
  wakeStoppedManagedTopod: mocks.wake
}))
vi.mock('./topod-managed-migration-status', () => ({
  findIncompleteManagedTopodMigration: mocks.pendingMigration
}))
vi.mock('../activation/topod-activation-transaction-store', () => ({
  readTopodActivationTransaction: async () => null
}))

const { getManagedTopodRuntimeStatus } = await import('./topod-runtime-status')
const { updateManagedTopodEnvironment } = await import('./topod-runtime-maintenance')
const { recoverManagedTopodEnvironment } = await import('./topod-managed-recovery')
const { rollbackManagedTopodEnvironment } = await import('./topod-managed-rollback')

const idle = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 7 }
let harness: ReturnType<typeof createManagedLifecycleHarness>

beforeEach(() => {
  vi.resetAllMocks()
  harness = createManagedLifecycleHarness()
  mocks.state.store = harness.targetStore
  mocks.resolveContext.mockImplementation(async () => harness.context())
  mocks.census.mockResolvedValue(idle)
  mocks.probe.mockResolvedValue(managedReadiness())
  mocks.buildHash.mockResolvedValue('previous-hash')
  mocks.recover.mockResolvedValue({ outcome: 'none' })
  mocks.wake.mockResolvedValue({ outcome: 'serving' })
})

afterEach(() => rmSync(harness.userDataPath, { recursive: true, force: true }))

function expectEnrolledPairing(): void {
  const [environment] = listEnvironments(harness.userDataPath)
  expect(environment?.endpoints[0]?.deviceToken).toBe('device-token')
  expect(environment?.pairingRevision).toBe(harness.environment.pairingRevision)
  expect(environment?.topodDeployment).toEqual(harness.environment.topodDeployment)
}

describe('updateManagedTopodEnvironment', () => {
  it('defers over live or unverifiable terminals and reports the deferral in status', async () => {
    mocks.census.mockResolvedValue({ ...idle, liveSessions: null })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '0.3.0+new',
      code: 'topod_update_terminal_census_unavailable',
      reason: 'The terminal daemon did not answer a session count.'
    })
    const result = await updateManagedTopodEnvironment(harness.userDataPath, {
      selector: 'Managed'
    })
    expect(result).toMatchObject({ outcome: 'deferred', forceable: false })
    expect(mocks.deploy.mock.calls[0]?.[0]).toMatchObject({
      census: { liveSessions: null },
      port: 6_768,
      nodePath: ''
    })
    const status = await getManagedTopodRuntimeStatus(harness.userDataPath, 'Managed')
    expect(status.deferredUpdate).toMatchObject({
      candidateVersion: '0.3.0+new',
      code: 'topod_update_terminal_census_unavailable'
    })
    expect(status.terminals.liveSessions).toBeNull()
  })

  it('clears the deferral once an update goes through and keeps an unchanged pairing as is', async () => {
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '0.3.0+new',
      code: 'topod_update_terminals_running',
      reason: 'busy'
    })
    await updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-and-activated',
      fullVersion: '0.3.0+new'
    })
    const result = await updateManagedTopodEnvironment(harness.userDataPath, {
      selector: 'Managed',
      force: true
    })
    expect(result).toMatchObject({ outcome: 'updated', activeVersion: '0.3.0+new' })
    expect(mocks.probe).toHaveBeenCalledWith(expect.anything(), {
      buildHash: 'local-hash',
      fullVersion: '0.3.0+new'
    })
    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.pairingRevision).toBe(harness.environment.pairingRevision)
    expect(environment?.topodDeployment).toEqual(harness.environment.topodDeployment)
    const status = await getManagedTopodRuntimeStatus(harness.userDataPath, 'Managed')
    expect(status.deferredUpdate).toBeNull()
  })

  it('still reports the activation when the new forward cannot be built yet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.rebuildTunnel.mockRejectedValueOnce(new Error('ssh connect failed'))
    await expect(
      updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'updated', activeVersion: 'v3' })
  })

  it('keeps a pairing the terminal count repaired, not the one read before it', async () => {
    mocks.census.mockImplementationOnce(async () => {
      refreshManagedTopodPairing(
        harness.userDataPath,
        'environment-1',
        encodePairingOffer({
          v: PAIRING_OFFER_VERSION,
          endpoint: `ws://127.0.0.1:${MANAGED_LOCAL_PORT}/`,
          deviceToken: 'repaired-token',
          publicKeyB64: 'public-key'
        })
      )
      return idle
    })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: MANAGED_VERSION })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.endpoints[0]?.deviceToken).toBe('repaired-token')
  })

  it('keeps the enrolled grant when the updated server offers a new device', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })

  it('saves the new pairing on the tunnel port the census moved to', async () => {
    mocks.census.mockImplementationOnce(async () => {
      moveManagedTopodLocalPort(harness.userDataPath, 'environment-1', MANAGED_LOCAL_PORT + 1)
      return idle
    })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.probe.mockResolvedValueOnce(managedReadiness())

    await updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })

    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.topodDeployment?.localPort).toBe(MANAGED_LOCAL_PORT + 1)
    expect(environment?.endpoints[0]?.endpoint).toBe(`ws://127.0.0.1:${MANAGED_LOCAL_PORT + 1}/`)
  })
})

describe('updateManagedTopodEnvironment on a host already running this build', () => {
  beforeEach(() => {
    mocks.deploy.mockResolvedValue({ outcome: 'already-active', fullVersion: MANAGED_VERSION })
  })

  it('starts a slot proven stopped and forwards to the port it bound', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: managedReadiness() })
    await expect(
      updateManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'already-current', activeVersion: MANAGED_VERSION })
    expect(mocks.wake.mock.calls[0]?.[0]).toMatchObject({ port: 6_768 })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })
})

describe('rollbackManagedTopodEnvironment', () => {
  it.each([
    [{ ...idle, liveSessions: 2 }, 'topod_rollback_terminals_running'],
    [{ ...idle, liveSessions: null }, 'topod_rollback_census_unavailable']
  ])('refuses while terminals run or cannot be counted: %j', async (census, code) => {
    mocks.census.mockResolvedValue(census)
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('refuses with no previous version without contacting the slot', async () => {
    mocks.resolveContext.mockImplementation(async () => harness.context({ previous: null }))
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'topod_rollback_no_target' })
    expect(mocks.census).not.toHaveBeenCalled()
  })

  it('refuses while a migration into the server is unfinished', async () => {
    mocks.pendingMigration.mockReturnValueOnce({ migrationId: 'm-1', phase: 'destination-staged' })
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'topod_rollback_migration_in_progress' })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('refuses a rollback to a snapshot older than the migrated catalog, not a newer one', async () => {
    recordManagedTopodMigration(harness.userDataPath, 'environment-1', '2026-02-01T00:00:00.000Z')
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'topod_rollback_crosses_migration' })
    expect(mocks.rollback).not.toHaveBeenCalled()
    mocks.resolveContext.mockImplementation(async () =>
      harness.context({ activatedAt: '2026-03-01T00:00:00.000Z' })
    )
    mocks.rollback.mockResolvedValueOnce({ outcome: 'refused', code: 'x', reason: 'y' })
    await rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(mocks.rollback).toHaveBeenCalledOnce()
  })

  it('refuses a rollback across a retained delta move that predates the mark', async () => {
    // Older deltas lack a durable mark; their retained journal must still block destructive rollback.
    writeTopodMigrationSourceCutover(harness.userDataPath, {
      ...topodMigrationCutoverFixture('delta-1', 'ssh-1', { environmentId: 'environment-1' }),
      startedAt: '2026-02-01T00:00:00.000Z',
      phase: 'destination-committed',
      sourceRetainedAt: '2026-02-01T00:00:00.000Z'
    })
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'topod_rollback_crosses_migration' })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('rolls back against the installed bytes of the previous slot', async () => {
    mocks.rollback.mockResolvedValueOnce({
      outcome: 'rolled-back',
      target: MANAGED_PREVIOUS_VERSION,
      discarded: [MANAGED_VERSION],
      verdict: { decision: 'activate', coverage: 'pty-spawn', warnings: [] }
    })
    await expect(
      rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'rolled-back', activeVersion: MANAGED_PREVIOUS_VERSION })
    expect(mocks.rollback.mock.calls[0]?.[0]).toMatchObject({ targetBuildHash: 'previous-hash' })
    expect(mocks.probe).toHaveBeenCalledWith(expect.anything(), {
      buildHash: 'previous-hash',
      fullVersion: MANAGED_PREVIOUS_VERSION
    })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })

  it('keeps the enrolled grant when the restored server offers a new device', async () => {
    mocks.rollback.mockResolvedValueOnce({
      outcome: 'rolled-back',
      target: MANAGED_PREVIOUS_VERSION,
      discarded: [MANAGED_VERSION],
      verdict: { decision: 'activate', coverage: 'pty-spawn', warnings: [] }
    })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await rollbackManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })
})

describe('recoverManagedTopodEnvironment', () => {
  it('keeps the enrolled grant when the recovered server offers a new device', async () => {
    mocks.recover.mockResolvedValueOnce({
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: MANAGED_VERSION,
      readiness: managedReadiness('startup-offer-token')
    })
    await recoverManagedTopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })
})
