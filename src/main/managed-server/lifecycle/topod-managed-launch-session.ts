import { randomUUID } from 'node:crypto'
import type { TopodManagedRestartResult } from '../../../shared/topod-managed-runtime'
import {
  withTopodActivationLock,
  type TopodActivationLockControl
} from '../activation/topod-activation-lock'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import {
  topodLaunchSshSessionProbeCommand,
  parseTopodLaunchSshSession,
  recordsTopodLaunchSshSession,
  type TopodLaunchSshSession
} from '../install/topod-launch-ssh-session'
import { withManagedTopodLifecycle } from './topod-managed-lifecycle'
import {
  managedTopodInstallDir,
  managedTopodSlot,
  requireManagedTopodEnvironment,
  requireManagedTopodInfrastructure,
  resolveLinkedTopodContext
} from './topod-managed-runtime-context'
import { resolveTopodRemoteContext } from '../install/topod-remote-context'

import { rebuildTopodManagedTunnel } from './topod-managed-tunnel'
import { wakeStoppedManagedTopod } from './topod-managed-wake'
import { readRemoteTopodManagedStopTarget } from './topod-managed-remote-stop'
import { topodSlotDir, type TopodSlotOptions } from '../activation/topod-recovery-slot'
import { stopIncumbentBehindTerminalBarrier } from './topod-rollback-terminal-barrier'
import { execTopodRemote } from '../install/topod-remote-runtime-control'
import { collectManagedTerminalCensus } from './topod-terminal-census-client'
import { runFencedStop, updateTerminalCounts } from '../activation/topod-fenced-stop'

export async function readManagedTopodLaunchSshSession(
  userDataPath: string,
  environmentId: string
): Promise<TopodLaunchSshSession> {
  const { deployment } = requireManagedTopodEnvironment(userDataPath, environmentId)
  const { connectionManager, targetStore } = requireManagedTopodInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  // Background checks must not reconnect hosts the user left.
  const connection =
    target && connectionManager.getState(target.id)?.status === 'connected'
      ? (connectionManager.getConnection(target.id) ?? null)
      : null
  if (!target || !connection) {
    return 'unverifiable'
  }
  const context = await resolveTopodRemoteContext(target, connection)
  if (!recordsTopodLaunchSshSession(context.host)) {
    return 'not-applicable'
  }
  const active = context.activationRecord.active
  if (!active) {
    return 'not-recorded'
  }
  return parseTopodLaunchSshSession(
    await execTopodRemote(
      { conn: context.connection, host: context.host },
      topodLaunchSshSessionProbeCommand(
        context.host,
        managedTopodInstallDir(context, active),
        context.userDataDir
      )
    )
  )
}

/** Restart only without terminals: surviving daemons retain the old SSH-session attribution. */
export function restartManagedTopodEnvironment(
  userDataPath: string,
  selector: string
): Promise<TopodManagedRestartResult> {
  return withManagedTopodLifecycle(userDataPath, selector, async ({ environment, deployment }) => {
    const context = await resolveLinkedTopodContext(environment, deployment)
    if (!context.activationRecord.active) {
      return { outcome: 'not-restarted', reason: 'This host has no activated Topo server.' }
    }
    const counts = updateTerminalCounts((options) =>
      collectManagedTerminalCensus(
        userDataPath,
        environment,
        context.activationRecord,
        undefined,
        options
      )
    )
    // Reject live terminals before waiting for the host lock.
    const census = await counts.countFirst()
    if (census.liveSessions !== 0) {
      return { outcome: 'terminals-running', liveSessions: census.liveSessions }
    }
    const slot = managedTopodSlot(context, deployment.remotePort)
    const stopped = await withTopodActivationLock(
      slot,
      (lock) => recountThenStop(slot, lock, counts),
      (): StopOutcome => ({
        state: 'kept',
        reason: 'An update, rollback or recovery holds this host; try again when it finishes.'
      })
    )
    if (stopped.state === 'terminals-running') {
      return { outcome: 'terminals-running', liveSessions: stopped.liveSessions }
    }
    if (stopped.state === 'kept') {
      return { outcome: 'not-restarted', reason: stopped.reason }
    }
    // Wake even when daemon retirement failed: the stopped server cannot serve clients.
    const wake = await wakeStoppedManagedTopod(slot)
    if (wake.outcome !== 'started' && wake.outcome !== 'serving') {
      return {
        outcome: 'not-restarted',
        reason:
          wake.outcome === 'recovery-refused'
            ? wake.reason
            : `This host’s Topo server stopped but did not start again (${wake.outcome}); reconnect to start it.`
      }
    }
    // Restart may bind a different port than the existing forward.
    await rebuildTopodManagedTunnel(userDataPath, environment.id)
    const dir = topodSlotDir(slot, stopped.version)
    if (stopped.state === 'daemon-kept') {
      // A retained daemon keeps old attribution, so preserve the warning.
      return { outcome: 'not-restarted', reason: stopped.reason }
    }
    const session = parseTopodLaunchSshSession(
      await execTopodRemote(
        slot,
        topodLaunchSshSessionProbeCommand(slot.host, dir, slot.userDataDir)
      )
    )
    if (session === 'exited') {
      return {
        outcome: 'not-restarted',
        reason:
          'This host’s Topo server restarted, but its terminals still belong to an SSH session ' +
          'that has ended: its terminal daemon was still running, or this connection opens a ' +
          'new SSH session for each command. Turn on SSH connection reuse for this host if ' +
          'it is off, then restart again.'
      }
    }
    return { outcome: 'restarted', environmentId: environment.id }
  })
}

type StopOutcome =
  | { state: 'retired'; version: string }
  /** The surviving daemon still spawns terminals with old attribution. */
  | { state: 'daemon-kept'; version: string; reason: string }
  /** Serving or possibly stopping; do not start another instance. */
  | { state: 'kept'; reason: string; mayBeStopping?: true }
  | { state: 'terminals-running'; liveSessions: number | null }

/** Only the host lock holder may close/reopen admission, preserving other runs' fences. */
async function recountThenStop(
  slot: TopodSlotOptions,
  lock: TopodActivationLockControl,
  counts: ReturnType<typeof updateTerminalCounts>
): Promise<StopOutcome> {
  const fenced = await runFencedStop({
    ...counts,
    now: Date.now,
    refuse: (census): StopOutcome | null =>
      census.liveSessions === 0
        ? null
        : { state: 'terminals-running', liveSessions: census.liveSessions },
    stale: (): StopOutcome => STALE_COUNT,
    stop: (stillFenced) => stopRetiringIdleDaemon(slot, lock, stillFenced),
    // Woken servers start with admission open; only unsent stops need reopening.
    stopMayHaveBeenSent: (outcome) =>
      outcome.state === 'retired' ||
      outcome.state === 'daemon-kept' ||
      (outcome.state === 'kept' && outcome.mayBeStopping === true)
  })
  return 'refused' in fenced ? fenced.refused : fenced.stopped
}

const STALE_COUNT: StopOutcome = {
  state: 'kept',
  reason: 'The terminal count went stale before the stop. Restart again.'
}

async function stopRetiringIdleDaemon(
  slot: TopodSlotOptions,
  lock: TopodActivationLockControl,
  stillFenced: () => boolean
): Promise<StopOutcome> {
  // Other clients may change the active slot; reread under the fence.
  const active = (await readTopodActivationRecord(slot)).active
  if (!active) {
    return { state: 'kept', reason: 'This host has no activated Topo server.' }
  }
  const target = await readRemoteTopodManagedStopTarget(slot, active)
  if (target.state === 'refused') {
    return { state: 'kept', reason: target.reason }
  }
  // Expired census fences may have admitted terminals; do not stop after expiry.
  if (!stillFenced()) {
    return STALE_COUNT
  }
  const barrier = await stopIncumbentBehindTerminalBarrier(slot, randomUUID(), target.context)
  switch (barrier.state) {
    case 'retired':
      return { state: 'retired', version: active }
    case 'unproven':
      return {
        state: 'daemon-kept',
        version: active,
        reason:
          'This host’s Topo server restarted, but its terminal daemon kept running because a terminal ' +
          'was open at the stop, so terminals may still lack local network access.'
      }
    case 'unsettled':
      // Recovery must retain the fence while topod may still be stopping.
      lock.retain()
      return { state: 'kept', reason: barrier.reason, mayBeStopping: true }
    case 'withdrawn':
      return { state: 'kept', reason: barrier.reason }
  }
}
