// Let the active slot gather lock evidence and apply nonce-pinned confirmation; clients only relay it.
import { z } from 'zod'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  TOPOD_RECLAIM_STALE_LOCK_FLAG,
  TOPOD_STALE_LOCK_DATA_ROOT_FLAG,
  TOPOD_STALE_LOCK_EXPECT_NONCE_FLAG
} from '../../../shared/topod-stale-lock-reclaim'
import type {
  TopodManagedStaleLockReclaimRequest,
  TopodManagedStaleLockReclaimResult
} from '../../../shared/topod-managed-runtime'
import {
  TOPOD_LAUNCHER_FILENAME,
  TOPOD_SERVER_ENTRY_FILENAME
} from '../../../shared/topod-artifacts'
import { withTopodActivationLock } from '../activation/topod-activation-lock'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import { followLaunchedServerPort, withManagedTopodLifecycle } from './topod-managed-lifecycle'
import { managedTopodSlot, resolveLinkedTopodContext } from './topod-managed-runtime-context'
import { selectTopodSlotRuntimeCommand } from '../install/topod-remote-runtime'
import { execTopodRemote } from '../install/topod-remote-runtime-control'
import { topodSlotDir, type TopodSlotOptions } from '../activation/topod-recovery-slot'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { wakeStoppedManagedTopod } from './topod-managed-wake'
import { TOPOD_LOCK_FILE_NAME } from '../../topod/topod-instance-lock'
import { errorMessage } from '../../../shared/error-message'

const ReclaimStatusSchema = z.enum(['none', 'eligible', 'refused', 'reclaimed'])

// Unknown newer statuses map to no-answer rather than failing reply parsing.
const ReclaimAnswerSchema = z.object({
  status: z.string(),
  lockPath: z.string(),
  message: z.string(),
  evidence: z
    .object({
      pid: z.number(),
      host: z.string(),
      bootId: z.string(),
      currentBootId: z.string(),
      ageMinutes: z.number(),
      nonce: z.string().optional()
    })
    .optional()
})

const RECLAIM_UNSUPPORTED_SENTINEL = 'TOPO_STALE_LOCK_RECLAIM_UNSUPPORTED'
const RECLAIM_UNPINNED_SENTINEL = 'TOPO_STALE_LOCK_RECLAIM_UNPINNED'

type ReclaimAnswer = Omit<z.infer<typeof ReclaimAnswerSchema>, 'status'> & {
  status: z.infer<typeof ReclaimStatusSchema>
}

type SlotReclaim =
  | { status: 'answered'; answer: ReclaimAnswer }
  /** Slots without nonce pinning require manual reclamation. */
  | { status: 'unsupported' | 'unpinned' | 'no-answer' | 'busy'; message: string }

export function runManagedTopodStaleLockReclaim(
  userDataPath: string,
  selector: string,
  request: TopodManagedStaleLockReclaimRequest
): Promise<TopodManagedStaleLockReclaimResult> {
  return withManagedTopodLifecycle(userDataPath, selector, async ({ environment, deployment }) => {
    const context = await resolveLinkedTopodContext(environment, deployment)
    if (context.host.os !== 'linux') {
      return unsupported('This host’s Topo server has no stale-lock recovery.')
    }
    const slot = managedTopodSlot(context, deployment.remotePort)
    // Serialize reclamation with launch so wake cannot race lock removal.
    const ran = await withTopodActivationLock(
      slot,
      () => runOnActiveSlot(slot, request),
      (): SlotReclaim => ({
        status: 'busy',
        message: 'An update, rollback or recovery holds this host; try again when it finishes.'
      })
    )
    if (ran.status === 'unsupported') {
      const lockPath = joinRemotePath(slot.host, slot.userDataDir, TOPOD_LOCK_FILE_NAME)
      return { status: 'unsupported', message: ran.message, lockPath }
    }
    if (ran.status === 'unpinned') {
      return { status: 'unsupported', message: ran.message, reclaimWithoutPin: true }
    }
    if (ran.status !== 'answered') {
      return { status: ran.status, message: ran.message }
    }
    const { answer } = ran
    if (answer.status !== 'reclaimed') {
      return { ...answer, status: answer.status }
    }
    const reclaimed = {
      status: 'reclaimed',
      environmentId: environment.id,
      message: answer.message,
      lockPath: answer.lockPath,
      ...(answer.evidence ? { evidence: answer.evidence } : {})
    } as const
    const notRestarted = await restartAfterReclaim(userDataPath, environment.id, slot)
    return notRestarted ? { ...reclaimed, notRestarted } : reclaimed
  })
}

/** Preserve successful reclamation even if restart fails; return the restart warning. */
async function restartAfterReclaim(
  userDataPath: string,
  environmentId: string,
  slot: TopodSlotOptions
): Promise<string | null> {
  try {
    const wake = await wakeStoppedManagedTopod(slot)
    if (wake.outcome !== 'started' && wake.outcome !== 'serving') {
      return wake.outcome === 'recovery-refused'
        ? wake.reason
        : `The lock was cleared, but this host’s Topo server did not start (${wake.outcome}); reconnect to start it.`
    }
    await followLaunchedServerPort(userDataPath, environmentId)
    return null
  } catch (error) {
    // Still return a result so callers can reconnect and clear stale notes.
    return `The lock was cleared, but this host’s Topo server did not start: ${errorMessage(error)}`
  }
}

async function runOnActiveSlot(
  slot: TopodSlotOptions,
  request: TopodManagedStaleLockReclaimRequest
): Promise<SlotReclaim> {
  // Another client may change the active slot while this one waits for the lock.
  const active = (await readTopodActivationRecord(slot)).active
  if (!active) {
    return { status: 'unsupported', message: 'This host has no activated Topo server.' }
  }
  const slotDir = topodSlotDir(slot, active)
  const entry = joinRemotePath(slot.host, slotDir, TOPOD_LAUNCHER_FILENAME)
  const bundle = joinRemotePath(slot.host, slotDir, TOPOD_SERVER_ENTRY_FILENAME)
  const confirm = request.yes
    ? ` ${TOPOD_STALE_LOCK_EXPECT_NONCE_FLAG} ${quotePosixShell(request.expectNonce)} --yes`
    : ''
  // Check support first: old slots might start serving or reclaim an unapproved replacement lock.
  const command =
    `if grep -qF -- ${quotePosixShell(TOPOD_STALE_LOCK_EXPECT_NONCE_FLAG)} ${quotePosixShell(bundle)} 2>/dev/null; then ` +
    `${selectTopodSlotRuntimeCommand(slot.host, slotDir, '')} && ` +
    `"$topod_runtime" ${quotePosixShell(entry)} ${TOPOD_RECLAIM_STALE_LOCK_FLAG} ` +
    `${TOPOD_STALE_LOCK_DATA_ROOT_FLAG} ${quotePosixShell(slot.userDataDir)} --json${confirm}; ` +
    `elif grep -qF -- ${quotePosixShell(TOPOD_RECLAIM_STALE_LOCK_FLAG)} ${quotePosixShell(bundle)} 2>/dev/null; then ` +
    `echo ${RECLAIM_UNPINNED_SENTINEL}; else echo ${RECLAIM_UNSUPPORTED_SENTINEL}; fi`
  let output: string
  try {
    output = await execTopodRemote(slot, command)
  } catch (error) {
    // Non-reclaimed outcomes exit nonzero but still print structured replies.
    if (!isSshCommandExitError(error)) {
      throw error
    }
    output = error.stdout
  }
  const lines = output.split('\n').map((line) => line.trim())
  if (lines.includes(RECLAIM_UNSUPPORTED_SENTINEL)) {
    return unsupported('This host’s Topo server predates the stale-lock recovery.')
  }
  if (lines.includes(RECLAIM_UNPINNED_SENTINEL)) {
    return {
      status: 'unpinned',
      message: 'This host’s Topo server is too old for Topo to clear the lock from here.'
    }
  }
  const answer = parseReclaimAnswer(output)
  return answer
    ? { status: 'answered', answer }
    : {
        status: 'no-answer',
        message: 'This host’s Topo server gave no answer Topo understands to the stale-lock check.'
      }
}

function parseReclaimAnswer(output: string): ReclaimAnswer | null {
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    return null
  }
  try {
    const parsed = ReclaimAnswerSchema.safeParse(JSON.parse(line))
    const status = ReclaimStatusSchema.safeParse(parsed.data?.status)
    return parsed.success && status.success ? { ...parsed.data, status: status.data } : null
  } catch {
    return null
  }
}

function unsupported(message: string): { status: 'unsupported'; message: string } {
  return { status: 'unsupported', message }
}
