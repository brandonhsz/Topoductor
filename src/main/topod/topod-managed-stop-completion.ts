// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  TopodManagedStopRequestSchema,
  topodManagedStopRequestKey,
  type TopodManagedStopInstance,
  type TopodManagedStopRequest,
  type TopodManagedStopVerdict
} from '../../shared/topod-stop-request'
import {
  compareTopodProcessIdentity,
  recordedTopodProcessIncarnation,
  type TopodProcessIdentityReaders,
  type TopodRecordedIdentity
} from './topod-process-start-time'
import {
  hasErrorCode,
  inspectProcessSignal
} from '../daemon/endpoint/identity/daemon-process-inspection'
import { persistTopodCompletedStopReceipt } from './topod-completed-stop-receipt'
import { readTopodManagedStopDecision } from './topod-managed-stop-decision'
import { withdrawTopodManagedStopRequest } from './topod-managed-stop-cancellation'
import {
  topodInstanceLockNames,
  topodManagedStopRequestPath,
  readTopodInstanceLockNaming,
  readTopodManagedStopRequest
} from './topod-managed-stop-request'
import {
  TOPOD_STOP_COMPLETION_POLL_ATTEMPTS,
  TOPOD_STOP_COMPLETION_POLL_MS
} from './topod-stop-deadlines'

type TopodProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type TopodManagedStopCompletionOptions = TopodProcessIdentityReaders & {
  probeProcess?: TopodProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<TopodProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: TopodManagedStopInstance,
  recorded: TopodRecordedIdentity,
  options: TopodManagedStopCompletionOptions
): TopodManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareTopodProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: TopodManagedStopInstance): TopodRecordedIdentity {
  if (recordedTopodProcessIncarnation(instance)) {
    return instance
  }
  let record: TopodRecordedIdentity | null = null
  try {
    record = readTopodInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedTopodProcessIncarnation(record), identity: record.identity }
}

export async function completeTopodManagedStop(
  input: TopodManagedStopRequest,
  options: TopodManagedStopCompletionOptions = {}
): Promise<TopodManagedStopVerdict> {
  const request = TopodManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? TOPOD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('topod_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistTopodCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readTopodManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = topodManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('topod_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readTopodManagedStopDecision(request) === 'canceled') {
    withdrawTopodManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(TOPOD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: TopodManagedStopInstance): boolean {
  try {
    return topodInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: TopodManagedStopRequest): boolean {
  try {
    return (
      topodManagedStopRequestKey(readTopodManagedStopRequest(path)) ===
      topodManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
