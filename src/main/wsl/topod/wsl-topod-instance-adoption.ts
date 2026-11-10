/** Adopt serving unrecorded topod under the activation fence only when lock, readiness and installed build identify the same process. Never kill it without census; launching another loses the instance lock. Normal update admission handles version changes. */
import { TOPOD_LOCK_FILE_NAME } from '../../topod/topod-instance-lock'
import {
  parseTopodInstanceLockRecord,
  type TopodLockRecord
} from '../../topod/topod-instance-lock-record'
import { compareTopodProcessIdentity } from '../../topod/topod-process-start-time'
import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import {
  readTopodActivationRecord,
  writeTopodActivationRecord
} from '../../managed-server/activation/topod-activation-record-store'
import { evaluateTopodActivation } from '../../managed-server/activation/topod-activation-gate'
import { withTopodActivationLock } from '../../managed-server/activation/topod-activation-lock'
import { sameTopodActivationRecord } from '../../managed-server/activation/topod-activation-transaction'
import { readTopodActivationTransaction } from '../../managed-server/activation/topod-activation-transaction-store'
import { readRemoteTopodManagedStopTarget } from '../../managed-server/lifecycle/topod-managed-remote-stop'
import {
  topodSlotDir,
  resolveTopodSlotIdentity,
  type TopodSlotOptions
} from '../../managed-server/activation/topod-recovery-slot'
import { TOPOD_PID_FILENAME } from '../../managed-server/install/topod-remote-host-support'
import {
  parseTopodReadinessWaitOutput,
  readTopodReadinessNowCommand
} from '../../managed-server/install/topod-remote-readiness-wait'
import { readBoundedTopodRemoteRecord } from '../../managed-server/install/topod-remote-record-file'
import { execTopodRemote } from '../../managed-server/install/topod-remote-runtime-control'
import {
  TOPOD_INSTALL_MODEL,
  remoteInstallDirName,
  remoteInstallVersionDirRegex
} from '../../managed-server/install/remote-install-model'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import {
  readWslGuestIdentity,
  wslGuestTopodIncarnation,
  type WslGuestIdentity
} from '../execution/wsl-guest-process-identity'
import type { WslTopodInstanceLockRead } from './wsl-topod-connect-state-snapshot'

const LOCK_RECORD_MAX_BYTES = 64 * 1024
const UNRECORDED_TOPOD_CODE = 'wsl_topod_unrecorded_instance_unverifiable'

export type WslTopodAdoption =
  | { outcome: 'none' }
  | { outcome: 'adopted'; version: string; pid: number; record: TopodActivationRecord }

export class WslTopodUnrecordedInstanceError extends Error {
  readonly code = UNRECORDED_TOPOD_CODE
  constructor(message: string) {
    super(message)
    this.name = 'WslTopodUnrecordedInstanceError'
  }
}

type LockHolder = { pid: number; version: string }

async function readLiveLockHolder(
  slot: TopodSlotOptions,
  preRead?: WslTopodInstanceLockRead
): Promise<LockHolder | null> {
  const lockPath = joinRemotePath(slot.host, slot.userDataDir, TOPOD_LOCK_FILE_NAME)
  const read =
    preRead ?? (await readBoundedTopodRemoteRecord(slot, lockPath, LOCK_RECORD_MAX_BYTES))
  const lock = read.state === 'present' ? parseTopodInstanceLockRecord(read.raw) : null
  // Desktop-role or malformed locks identify no topod to adopt.
  if (!lock || lock.role === 'desktop') {
    return null
  }
  // Adopt only proven-live holders; otherwise let the host's instance lock arbitrate launch.
  // The snapshot's identity counts only if it was read for this same pid.
  const known =
    preRead?.state === 'present' && preRead.holder?.pid === lock.pid ? preRead.holder.guest : null
  return (await lockHolderLiveness(slot, lock, known)) === 'live'
    ? { pid: lock.pid, version: lock.version }
    : null
}

type LockHolderLiveness = 'live' | 'unverifiable' | 'exited'

/** A PID is no identity after a distro restart reuses it: the lock's boot id and start ticks are. */
async function lockHolderLiveness(
  slot: TopodSlotOptions,
  lock: TopodLockRecord,
  known: WslGuestIdentity | null = null
): Promise<LockHolderLiveness> {
  const guest = known ?? (await readWslGuestIdentity(slot.conn, lock.pid))
  if (!guest) {
    return 'unverifiable'
  }
  const incarnation = wslGuestTopodIncarnation(guest)
  // The guest answered, and no process has that PID.
  if (!incarnation) {
    return 'exited'
  }
  // Compare boot IDs case-insensitively because readers normalize them.
  const recorded = lock.bootId ? { ...lock, bootId: lock.bootId.toLowerCase() } : lock
  const verdict = compareTopodProcessIdentity(lock.pid, recorded, {
    incarnation: () => incarnation,
    // Ignore wall-clock starts: guest clocks jump after host sleep.
    startedAtMs: () => null,
    platform: 'linux'
  })
  return verdict === 'matches' ? 'live' : verdict === 'differs' ? 'exited' : 'unverifiable'
}

async function readSlotPid(slot: TopodSlotOptions, version: string): Promise<number | null> {
  const pidFile = joinRemotePath(slot.host, topodSlotDir(slot, version), TOPOD_PID_FILENAME)
  const raw = await execTopodRemote(slot, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`)
  const pid = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** The holder's slot must publish readiness for this pid, from the build installed there. */
async function proveHolderServesItsSlot(slot: TopodSlotOptions, holder: LockHolder): Promise<void> {
  const label = `An topod (pid ${holder.pid}, ${holder.version}) is running in this distro but is not the recorded one`
  const dirName = remoteInstallDirName(TOPOD_INSTALL_MODEL, holder.version)
  if (!remoteInstallVersionDirRegex(TOPOD_INSTALL_MODEL).test(dirName)) {
    throw new WslTopodUnrecordedInstanceError(`${label}, and its version is not a slot name.`)
  }
  const target = await readRemoteTopodManagedStopTarget(slot, holder.version)
  if (target.state !== 'ready' || target.context.instance.pid !== holder.pid) {
    throw new WslTopodUnrecordedInstanceError(
      `${label}, and it cannot be identified: ${target.state === 'refused' ? target.reason : 'its readiness names another process.'}`
    )
  }
  const identity = await resolveTopodSlotIdentity(slot, holder.version)
  const readiness = parseTopodReadinessWaitOutput(
    slot.host,
    await execTopodRemote(slot, readTopodReadinessNowCommand(slot.host, identity.remoteDir))
  )
  const verdict = evaluateTopodActivation(
    readiness.state === 'ready' ? readiness.readiness : null,
    {
      buildHash: identity.buildHash,
      fullVersion: identity.version
    }
  )
  if (verdict.decision === 'reject') {
    throw new WslTopodUnrecordedInstanceError(`${label}, and ${verdict.reason}`)
  }
}

function adoptedRecord(
  record: TopodActivationRecord,
  version: string,
  now: Date
): TopodActivationRecord {
  if (record.active === version) {
    return record
  }
  const { activeAppVersion, previousAppVersion: _previousAppVersion, ...rest } = record
  return {
    ...rest,
    active: version,
    previous: record.active ?? record.previous,
    ...(record.active && activeAppVersion ? { previousAppVersion: activeAppVersion } : {}),
    activatedAt: now.toISOString(),
    // Prelaunch snapshot belongs to another activation; rollback must not restore it.
    snapshot: null
  }
}

/** Adopt lock owners missing from record/pid file only with proof; otherwise refuse rather than launch into an occupied instance lock. */
export async function adoptUnrecordedWslTopod(
  slot: TopodSlotOptions,
  record: TopodActivationRecord,
  now: () => Date = () => new Date(),
  /** This connect's snapshot of the lock; the fenced re-check below always reads the host. */
  preReadLock?: WslTopodInstanceLockRead
): Promise<WslTopodAdoption> {
  const holder = await readLiveLockHolder(slot, preReadLock)
  if (!holder) {
    return { outcome: 'none' }
  }
  if (
    record.active === holder.version &&
    (await readSlotPid(slot, holder.version)) === holder.pid
  ) {
    return { outcome: 'none' }
  }
  await proveHolderServesItsSlot(slot, holder)
  return withTopodActivationLock(
    slot,
    async () => {
      const current = await readTopodActivationRecord(slot)
      if (!sameTopodActivationRecord(current, record)) {
        throw new WslTopodUnrecordedInstanceError(
          'The activation record changed while an unrecorded topod was being adopted. Retry.'
        )
      }
      if (await readTopodActivationTransaction(slot)) {
        throw new WslTopodUnrecordedInstanceError(
          'An interrupted activation is pending, so an unrecorded topod cannot be adopted yet.'
        )
      }
      const again = await readLiveLockHolder(slot)
      if (again?.pid !== holder.pid || again.version !== holder.version) {
        throw new WslTopodUnrecordedInstanceError(
          'The unrecorded topod changed while it was being adopted. Retry.'
        )
      }
      const pidFile = joinRemotePath(
        slot.host,
        topodSlotDir(slot, holder.version),
        TOPOD_PID_FILENAME
      )
      await execTopodRemote(
        slot,
        `(umask 077 && printf '%s\\n' ${String(holder.pid)} > ${quotePosixShell(pidFile)})`
      )
      const next = adoptedRecord(current, holder.version, now())
      if (next !== current) {
        await writeTopodActivationRecord(slot, next)
      }
      return {
        outcome: 'adopted' as const,
        version: holder.version,
        pid: holder.pid,
        record: next
      }
    },
    () => {
      throw new WslTopodUnrecordedInstanceError(
        'Another Topo is changing this distro’s server, so an unrecorded topod cannot be adopted now.'
      )
    }
  )
}
