// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { TopodActivationRecord } from '../activation/topod-activation-record'
import {
  readTopodActivationRecord,
  writeTopodActivationRecord
} from '../activation/topod-activation-record-store'
import { sameTopodActivationRecord } from '../activation/topod-activation-transaction'
import { writeTopodActivationTransaction } from '../activation/topod-activation-transaction-store'
import { withTopodActivationLock } from '../activation/topod-activation-lock'
import { topodActivationFenceRefusal } from '../activation/topod-activation-fence-hold'
import {
  committedTopodDecommissionRecord,
  createTopodDecommissionTransaction,
  withTopodDecommissionProcessExited,
  withTopodDecommissionStopDispatched
} from '../lifecycle/topod-decommission-transaction'
import { readRemoteTopodManagedStopTarget } from '../lifecycle/topod-managed-remote-stop'
import { settleTopodDecommissionStop } from '../lifecycle/topod-decommission-stop'
import type { TopodSlotOptions } from '../activation/topod-recovery-slot'
import type { TopodDecommissionResult } from '../../../shared/topod-decommission'
import type { TopodTerminalCensus } from '../../../shared/topod-terminal-census'

type TopodDecommissionOptions = TopodSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: TopodActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: TopodTerminalCensus
  now?: () => Date
}

type Refusal = Extract<TopodDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: TopodTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'topod_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'topod_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteTopod(
  options: TopodDecommissionOptions
): Promise<TopodDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withTopodActivationLock(
    options,
    async (lock) => {
      const record = await readTopodActivationRecord(options)
      if (!sameTopodActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'topod_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'topod_decommission_nothing_active',
          'No topod version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteTopodManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createTopodDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeTopodActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withTopodDecommissionStopDispatched(transaction, request, now())
      await writeTopodActivationTransaction(options, transaction)

      const settlement = await settleTopodDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'topod_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'topod_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withTopodDecommissionProcessExited(transaction, now())
      await writeTopodActivationTransaction(options, transaction)
      await writeTopodActivationRecord(options, committedTopodDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await topodActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
