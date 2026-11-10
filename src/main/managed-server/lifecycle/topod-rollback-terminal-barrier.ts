// Pre-stop census can go stale; only fenced idle-daemon retirement proves snapshot replacement safe.
import {
  readRemoteTopodManagedStopTarget,
  type TopodManagedStopTarget
} from './topod-managed-remote-stop'
import { settleTopodDecommissionStop } from './topod-decommission-stop'
import type { TopodSlotOptions } from '../activation/topod-recovery-slot'
import type { TopodManagedStopContext } from '../../../shared/topod-stop-request'

type TopodRollbackBarrier =
  | { state: 'retired' }
  | { state: 'withdrawn'; reason: string }
  /** Stop underway or unconfirmed; retain the fence. */
  | { state: 'unsettled'; reason: string }
  /** Exit without proof of idle terminals requires restarting the incumbent. */
  | { state: 'unproven'; reason: string }

export async function readTopodRollbackBarrierTarget(
  options: TopodSlotOptions,
  version: string
): Promise<TopodManagedStopTarget> {
  const target = await readRemoteTopodManagedStopTarget(options, version)
  return target.state === 'ready'
    ? target
    : {
        ...target,
        code: 'topod_rollback_terminal_barrier_unavailable',
        reason:
          `${target.reason} A rollback needs topod to prove no terminal runs at its stop; ` +
          'nothing was changed.'
      }
}

export async function stopIncumbentBehindTerminalBarrier(
  options: TopodSlotOptions,
  transactionId: string,
  context: TopodManagedStopContext
): Promise<TopodRollbackBarrier> {
  const settlement = await settleTopodDecommissionStop(options, {
    schemaVersion: 1,
    transactionId,
    ...context,
    retireIdleDaemon: true
  })
  if (settlement.state === 'withdrawn' || settlement.state === 'unsettled') {
    return { state: settlement.state, reason: settlement.reason }
  }
  if (settlement.retirement === 'retired') {
    return { state: 'retired' }
  }
  return {
    state: 'unproven',
    reason:
      `topod ${context.version} stopped, but its terminal daemon reported ` +
      `${settlement.retirement} work at the stop, so the older snapshot was not restored.`
  }
}

type TopodRollbackBarrierRefusal = {
  outcome: 'refused' | 'failed'
  code: string
  reason: string
  retainFence: boolean
  restartIncumbent: boolean
}

/** Only retired daemons permit replacing current state with an older snapshot. */
export function rollbackBarrierRefusal(
  barrier: TopodRollbackBarrier
): TopodRollbackBarrierRefusal | null {
  switch (barrier.state) {
    case 'retired':
      return null
    case 'withdrawn':
      return {
        outcome: 'failed',
        code: 'topod_rollback_stop_withdrawn',
        reason: barrier.reason,
        retainFence: false,
        restartIncumbent: false
      }
    case 'unsettled':
      return {
        outcome: 'failed',
        code: 'topod_rollback_stop_incomplete',
        reason: `${barrier.reason} Nothing was restored.`,
        retainFence: true,
        restartIncumbent: false
      }
    case 'unproven':
      return {
        outcome: 'refused',
        code: 'topod_rollback_terminals_at_stop',
        reason: barrier.reason,
        retainFence: false,
        restartIncumbent: true
      }
  }
}
