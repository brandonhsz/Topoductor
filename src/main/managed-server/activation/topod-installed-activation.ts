/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { topodRemoteBaseDir } from '../install/topod-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { TopodDeployOptions, TopodDeployResult } from '../install/topod-remote-deploy'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  withActivatedVersion,
  type TopodActivationRecord,
  type TopodStateSnapshot
} from './topod-activation-record'
import {
  readTopodActivationRecord,
  writeTopodActivationRecord
} from './topod-activation-record-store'
import { launchAndJudgeTopodSlot } from './topod-candidate-launch-verdict'
import { planTopodUpdate } from './topod-update-plan'
import {
  type TopodTerminalCensus,
  UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
} from '../../../shared/topod-terminal-census'
import { runFencedStop } from './topod-fenced-stop'
import {
  censusNeedsHostDaemonProtocols,
  CURRENT_TOPOD_DAEMON_PROTOCOL
} from './topod-daemon-protocol-crossing'
import { TOPOD_LOG_FILENAME } from '../install/topod-remote-host-support'
import { topodSnapshotFailureReason } from '../host-state/topod-state-snapshot-space'
import {
  TOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  topodSnapshotRoomRefusal,
  topodSnapshotsRoot
} from '../host-state/topod-snapshot-room'
import {
  captureTopodStateSnapshotCommand,
  topodSnapshotDirName,
  parseTopodSnapshotCapture
} from '../host-state/topod-state-snapshot'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { computeLocalTopodBuildHash } from '../install/topod-local-build-hash'
import { preflightTopodCandidate } from './topod-candidate-preflight'
import type { TopodActivationLockControl } from './topod-activation-lock'
import type { TopodActivateTransaction } from './topod-activation-transaction'
import {
  createTopodActivationTransaction,
  withTopodActivationCandidateReady,
  withTopodActivationIncumbentStopped,
  withTopodActivationSnapshot
} from './topod-activation-transaction-transitions'
import { writeTopodActivationTransaction } from './topod-activation-transaction-store'
import { execTopodRemoteOr, withoutAbortSignal } from '../install/topod-remote-runtime-control'
import { execTopodStateMutationOr } from '../host-state/topod-state-mutation-exec'
import {
  initialTopodActivationAdmissionCommand,
  parseInitialTopodActivationAdmission
} from './topod-initial-activation-admission'
import {
  topodSlotDir,
  resolveTopodSlotIdentity,
  type TopodSlotIdentity
} from './topod-recovery-slot'
import { topodSnapshotPath } from './topod-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './topod-transaction-incumbent'
import { withTopodLogTail } from '../install/topod-remote-log-tail'
import { topodCandidateLaunchFailureCode } from '../../topod/topod-host-unavailable'
import { errorMessage } from '../../../shared/error-message'

type Outcome = Extract<TopodDeployResult, { outcome: 'installed-not-activated' }>

export const TOPOD_ACTIVATION_POLICY_REFUSED_CODE = 'topod_activation_policy_refused'

function countedLockedRecord(options: TopodDeployOptions, record: TopodActivationRecord): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
function censusForLockedRecord(
  options: TopodDeployOptions,
  record: TopodActivationRecord
): TopodTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
}

export async function activateInstalledTopod(
  options: TopodDeployOptions & { localTopodDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: TopodActivationLockControl
): Promise<TopodDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (code: string, reason: string, startCheckFailed?: true): Outcome => ({
    outcome: 'installed-not-activated',
    fullVersion,
    code,
    reason,
    ...(startCheckFailed ? { startCheckFailed } : {})
  })
  const record = await readTopodActivationRecord(options)
  const planFor = (
    census: TopodTerminalCensus,
    hostDaemonProtocols?: readonly number[]
  ): ReturnType<typeof planTopodUpdate> =>
    planTopodUpdate({
      record,
      candidateVersion: fullVersion,
      census,
      candidateDaemonProtocol: CURRENT_TOPOD_DAEMON_PROTOCOL,
      ...(hostDaemonProtocols ? { hostDaemonProtocols } : {}),
      ...(options.force !== undefined ? { force: options.force } : {})
    })
  const census = censusForLockedRecord(options, record)
  let plan = planFor(census)
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(TOPOD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  // Hosts predating the census protocol set cannot name mixed generations; the candidate can.
  const asksCandidate = censusNeedsHostDaemonProtocols(census)
  if (
    plan.action === 'defer' &&
    !(asksCandidate && plan.code === 'topod_update_daemon_protocol_unverifiable')
  ) {
    return notActivated(plan.code, plan.reason)
  }
  const preflight = await preflightTopodCandidate(
    { ...options, remoteInstallDir: remoteDir, fullVersion },
    asksCandidate
  )
  if ('failure' in preflight) {
    return notActivated('topod_candidate_preflight_failed', preflight.failure, true)
  }
  const { hostDaemonProtocols } = preflight
  plan = planFor(census, hostDaemonProtocols)
  if (plan.action === 'defer') {
    return notActivated(plan.code, plan.reason)
  }

  let incumbent: TopodSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveTopodSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'topod_incumbent_identity_unverifiable',
        `The active topod ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialTopodActivationAdmission(
      await execTopodRemoteOr(
        options,
        initialTopodActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await topodSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(TOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: TopodActivateTransaction = createTopodActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: topodSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (recounted) => {
        const plan = planFor(recounted, hostDaemonProtocols)
        return plan.action === 'defer' ? notActivated(plan.code, plan.reason) : null
      },
      prepare: () => writeTopodActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'topod_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. Topo will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'topod_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Topo ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeTopodActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withTopodActivationIncumbentStopped(transaction, now())
  await writeTopodActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = topodSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execTopodStateMutationOr(
    options,
    captureTopodStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      topodRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: topodSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseTopodSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = topodSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. Topo's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${topodRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: TopodStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withTopodActivationSnapshot(transaction, capture, now())
  await writeTopodActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeTopodSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalTopodBuildHash(options.localTopodDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            topodCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: topodSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, TOPOD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withTopodLogTail(options, remoteDir, located), true)
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withTopodActivationCandidateReady(transaction, recordAfter, now())
  await writeTopodActivationTransaction(options, transaction)
  await writeTopodActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
