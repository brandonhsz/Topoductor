// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logTopodActivationOutcome } from '../activation/topod-activation-outcome-log'
import type { TopodHostTransport } from './topod-host-transport'
import type { TopodActivationRecord } from '../activation/topod-activation-record'
import type { TopodTerminalCensus } from '../../../shared/topod-terminal-census'
import type { TopodActivationVerdict } from '../activation/topod-activation-gate'
import type { TopodDaemonProtocolFacts } from '../activation/topod-daemon-protocol-crossing'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import { sameTopodActivationRecord } from '../activation/topod-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  resolveTopodActivationReadinessTimeout,
  withTopodActivationLock
} from '../activation/topod-activation-lock'
import { topodActivationFenceRefusal } from '../activation/topod-activation-fence-hold'
import { TOPOD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/topod-profile-preflight'
import { rollbackTopodLocked } from '../lifecycle/topod-rollback-transition'

export type TopodRollbackOptions = {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: TopodActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: TopodTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<TopodTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: TopodDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type TopodRollbackResult =
  | { outcome: 'rolled-back'; target: string; discarded: string[]; verdict: TopodActivationVerdict }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackTopod(input: TopodRollbackOptions): Promise<TopodRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveTopodActivationReadinessTimeout(
      input.readinessTimeoutMs,
      TOPOD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logTopodActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withTopodActivationLock(
        options,
        async (lock) => {
          if (
            !sameTopodActivationRecord(await readTopodActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'topod_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackTopodLocked(options, lock)
        },
        async () => {
          const { code, reason } = await topodActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
