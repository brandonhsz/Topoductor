// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { selectTopodSlotRuntimeCommand } from '../install/topod-remote-runtime'
import {
  parseTopodReadinessWaitOutput,
  readTopodReadinessNowCommand
} from '../install/topod-remote-readiness-wait'
import { execTopodRemote } from '../install/topod-remote-runtime-control'
import { readBoundedTopodRemoteRecord } from '../install/topod-remote-record-file'
import { topodSlotDir, type TopodSlotOptions } from '../activation/topod-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  topodWindowsNodeCommandLine,
  topodWindowsSlotOpCommand,
  readTopodWindowsEncodedAnswer
} from '../install/topod-remote-windows-node'
import { TOPOD_WINDOWS_RUNTIME_MARKER } from '../host-state/topod-windows-host-script'
import { TOPOD_LOCK_FILE_NAME, parseTopodInstanceLockRecord } from '../../topod/topod-instance-lock'
import {
  TOPOD_CANCEL_MANAGED_STOP_FLAG,
  TOPOD_COMPLETE_MANAGED_STOP_FLAG,
  TOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
  TOPOD_STOP_REQUESTS_CAPABILITY,
  TopodManagedStopCancellationSchema,
  TopodManagedStopCompletionSchema,
  type TopodManagedStopCancellation,
  type TopodManagedStopCompletion,
  type TopodManagedStopContext,
  type TopodManagedStopRequest
} from '../../../shared/topod-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type TopodManagedStopTarget =
  | { state: 'ready'; context: TopodManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): TopodManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteTopodManagedStopTarget(
  options: TopodSlotOptions,
  version: string
): Promise<TopodManagedStopTarget> {
  const slotDir = topodSlotDir(options, version)
  const readiness = parseTopodReadinessWaitOutput(
    options.host,
    await execTopodRemote(options, readTopodReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'topod_managed_stop_readiness_unverifiable',
      `topod ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== TOPOD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'topod_managed_stop_unsupported',
      `topod ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, TOPOD_LOCK_FILE_NAME)
  const lockRead = await readBoundedTopodRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseTopodInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'topod_managed_stop_instance_unverifiable',
      `The instance lock does not name the topod ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteTopodManagedStop(
  options: TopodSlotOptions,
  request: TopodManagedStopRequest
): Promise<TopodManagedStopCompletion> {
  return TopodManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, TOPOD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteTopodManagedStop(
  options: TopodSlotOptions,
  request: TopodManagedStopRequest
): Promise<TopodManagedStopCancellation> {
  return TopodManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, TOPOD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: TopodSlotOptions,
  request: TopodManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = topodSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'topod.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execTopodRemote(
        options,
        `${selectTopodSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$topod_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('topod managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('topod managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('topod managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: TopodSlotOptions,
  slotDir: string,
  entry: string,
  request: TopodManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readTopodWindowsEncodedAnswer(
    await execTopodRemote(
      options,
      topodWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    TOPOD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this topod slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.topod-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execTopodRemote(
      options,
      topodWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        TOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execTopodRemote(
        options,
        topodWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
