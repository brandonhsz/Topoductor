/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execTopodStateMutation } from '../host-state/topod-state-mutation-exec'
import { topodRemoteBaseDir } from '../install/topod-remote-windows-node'
import type { ServeReadiness } from '../../server/serve-readiness'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'
import { TOPOD_STATE_SNAPSHOT_DIR } from './topod-activation-record'
import type { TopodSnapshotVerdict } from './topod-activation-transaction'
import {
  clearTopodStateSnapshotMembersCommand,
  compareTopodStateSnapshotCommand,
  topodSnapshotIsUnchanged,
  parseTopodSnapshotRestore,
  restoreTopodStateSnapshotCommand
} from '../host-state/topod-state-snapshot'
import { execTopodRemote } from '../install/topod-remote-runtime-control'
import {
  ensureTopodSlotServing,
  launchTopodSlot,
  quiesceInterruptedTopodSlot,
  type TopodSlotIdentity,
  type TopodSlotOptions
} from './topod-recovery-slot'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { TOPOD_RECOVERY_CHANGED_STATE_CODE } from '../../../shared/topod-managed-runtime'

export type TopodIncumbentRecoveryOptions = TopodSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type TopodIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function topodSnapshotPath(options: TopodSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    TOPOD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverTopodIncumbent(
  options: TopodIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: TopodSlotIdentity | null
    restoreState: TopodSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: TopodSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<TopodIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedTopodSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchTopodSlot(options, input.incumbent)
      : await ensureTopodSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: TopodIncumbentRecoveryOptions,
  state: TopodSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<TopodIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = topodSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execTopodRemote(
      options,
      compareTopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        topodRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (topodSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${topodSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: TOPOD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(options: TopodSlotOptions, state: TopodSnapshotVerdict): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreTopodStateSnapshotCommand(
          options.host,
          options.userDataDir,
          topodSnapshotPath(options, state.dirName),
          topodRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearTopodStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          topodRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseTopodSnapshotRestore(await execTopodStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
