// Topod exit does not prove terminal exit: the terminal daemon can outlive the server.
import { TOPOD_FENCE_OWNER_FILENAME } from '../activation/topod-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  topodActivationFenceExists,
  releaseTopodActivationFence,
  withTopodActivationLock
} from '../activation/topod-activation-lock'
import { topodLivenessProvenExited } from '../install/topod-remote-launch'
import { readBoundedTopodRemoteRecord } from '../install/topod-remote-record-file'
import { topodActivationFenceLockDir } from '../activation/topod-activation-transaction'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'

import { readTopodActivationTransaction } from '../activation/topod-activation-transaction-store'
import {
  TOPOD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedTopodActivation
} from '../activation/topod-activation-recovery'
import {
  ensureTopodSlotServing,
  topodSlotDir,
  resolveTopodSlotIdentity,
  slotLiveness,
  type TopodSlotOptions
} from '../activation/topod-recovery-slot'

type TopodManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  /** A recovery launch that failed is still a failed run. */
  | { outcome: 'fenced'; launchFailure?: Error }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string; launchFailure?: Error }

/** Proven stopped, but the caller's gate refused a new launch; only gated wakes can see it. */
type TopodManagedGatedWake = TopodManagedWake | { outcome: 'launch-refused' }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedTopod(
  options: TopodSlotOptions,
  onStarting?: () => void
): Promise<TopodManagedWake>
/** `mayLaunch` is checked under the fence, at the launch decision itself. */
export function wakeStoppedManagedTopod(
  options: TopodSlotOptions,
  onStarting: (() => void) | undefined,
  mayLaunch: () => boolean
): Promise<TopodManagedGatedWake>
export function wakeStoppedManagedTopod(
  options: TopodSlotOptions,
  onStarting: () => void = () => {},
  mayLaunch: () => boolean = () => true
): Promise<TopodManagedGatedWake> {
  return serializedWake(options, (host) => wakeAfterPrior(options, host, onStarting, mayLaunch))
}

/**
 * WSL's same-version connect: one fence both confirms `expectActive` is still the active slot
 * and starts it if proven stopped. 'replan' means another version is active now; 'fenced' that
 * the fence was busy. Either way the caller takes the full deploy and wake.
 */
export function wakeExpectedTopodUnderOneFence(
  options: TopodSlotOptions,
  expectActive: string
): Promise<TopodManagedWake | { outcome: 'replan' }> {
  return serializedWake(options, async (host) => {
    // An earlier wake's dropped fence is reclaimed only by the full wake, which knows its token.
    if (interruptedWakes.has(host)) {
      return { outcome: 'fenced' }
    }
    // Record ownership before acquisition, as the wake does: a dropped reply leaves a fence only it can reclaim.
    const token = randomUUID()
    interruptedWakes.set(host, token)
    const result = await withTopodActivationLock(
      options,
      async (): Promise<TopodManagedWake | { outcome: 'replan' }> => {
        if ((await readTopodActivationRecord(options)).active !== expectActive) {
          return { outcome: 'replan' }
        }
        const liveness = await slotLiveness(options, topodSlotDir(options, expectActive))
        if (!topodLivenessProvenExited(liveness)) {
          return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
        }
        const identity = await resolveTopodSlotIdentity(options, expectActive)
        return { outcome: 'started', readiness: await ensureTopodSlotServing(options, identity) }
      },
      (): TopodManagedWake => ({ outcome: 'fenced' }),
      token
    )
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
    return result
  })
}

function serializedWake<T>(
  options: TopodSlotOptions,
  run: (host: string) => Promise<T>
): Promise<T> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<T> => {
    await prior?.catch(() => {})
    return run(host)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: TopodSlotOptions,
  host: string,
  onStarting: () => void,
  mayLaunch: () => boolean
): Promise<TopodManagedGatedWake> {
  const before = await readTopodActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, topodSlotDir(options, before.active))
  if (!topodLivenessProvenExited(liveness)) {
    await forgetSettledInterruptedWake(options, host, liveness === 'LIVE')
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await topodActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    // Recovery can relaunch the slot, so a refused launch skips it too.
    if (!mayLaunch()) {
      return { outcome: 'launch-refused' }
    }
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withTopodActivationLock(
    options,
    async (): Promise<TopodManagedGatedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readTopodActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      if (!mayLaunch()) {
        return { outcome: 'launch-refused' }
      }
      const identity = await resolveTopodSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureTopodSlotServing(options, identity) }
    },
    (): TopodManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: TopodSlotOptions,
  onStarting: () => void
): Promise<TopodManagedWake | null> {
  const recovery = await recoverInterruptedTopodActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused': {
      // A failed launch inside recovery is still a failed run.
      const failure = recovery.launchFailure ? { launchFailure: recovery.launchFailure } : {}
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === TOPOD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced', ...failure }
        : { outcome: 'recovery-refused', reason: recovery.reason, ...failure }
    }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<unknown>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: TopodSlotOptions): string {
  return joinRemotePath(
    options.host,
    topodActivationFenceLockDir(options.host, options.remoteHome),
    TOPOD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: TopodSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/**
 * A serving slot skips the fence branch that clears an interrupted wake's token, which would
 * keep the one-fence wake off until restart. Forget it once its fence is gone or another owner's;
 * an unanswered probe proves neither, so the token stays. A fence still ours whose dropped launch
 * did start the slot (proven LIVE, no journal) is released, or deploys would wait for it to age out.
 */
async function forgetSettledInterruptedWake(
  options: TopodSlotOptions,
  host: string,
  slotLive: boolean
): Promise<void> {
  const token = interruptedWakes.get(host)
  if (!token) {
    return
  }
  try {
    const owner = (await topodActivationFenceExists(options))
      ? await readBoundedTopodRemoteRecord(options, wakeOwnerPath(options), 64)
      : null
    const ours = owner?.state === 'present' && owner.raw.trim() === token
    if (ours && slotLive && !(await readTopodActivationTransaction(options))) {
      // The release command re-proves the owner token on the host before removing anything.
      await releaseTopodActivationFence(options, token)
    } else if (ours || owner?.state === 'absent') {
      return
    }
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
  } catch {
    // Unverifiable: keep the token for the next wake.
  }
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: TopodSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readTopodActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedTopodRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseTopodActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
