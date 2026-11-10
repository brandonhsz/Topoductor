import {
  planManagedTopodAutoUpdate,
  type ManagedTopodAutoUpdateSkip
} from './topod-managed-update-decision'
import { TopodCrashLoopError } from './topod-managed-crash-loop'
import { materializeTopodArtifact } from '../../topod/topod-artifact-materializer'
import {
  TopodArtifactsUnavailableError,
  TopodHostUnsupportedError
} from '../../topod/topod-host-unavailable'
import { findIncompleteManagedTopodMigration } from './topod-managed-migration-status'
import { TOPOD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/topod-activation-fence-hold'
import { resolveLinkedTopodContext } from './topod-managed-runtime-context'
import { runManagedTopodUpdate } from './topod-runtime-maintenance'
import { withManagedTopodLifecycle } from './topod-managed-lifecycle'
import type { TopodUpdateDeferCode } from '../activation/topod-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedTopodAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedTopodAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  TopodUpdateDeferCode | typeof TOPOD_ACTIVATION_FENCE_BUSY_CODE
>([
  TOPOD_ACTIVATION_FENCE_BUSY_CODE,
  'topod_update_terminals_running',
  'topod_update_terminal_census_unavailable',
  'topod_update_strands_live_terminals',
  'topod_update_daemon_protocol_unverifiable',
  'topod_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingTopodUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export function autoUpdateManagedTopodEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedTopodAutoUpdateOutcome> {
  return withManagedTopodLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedTopodMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedTopodContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedTopodVersion(context.serverTarget)
    const plan = planManagedTopodAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedTopodAutoUpdateSkip | null = null
    try {
      const result = await runManagedTopodUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedTopodAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingTopodUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      // The host already runs this build; the brake's reason shows on its server status instead.
      if (error instanceof TopodCrashLoopError) {
        return { outcome: 'skipped', reason: 'current' }
      }
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type TopodTarget = Parameters<typeof materializeTopodArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<TopodTarget, Promise<string | null>>()

/** This build's topod version for `target`; null when the build bundles none for it. */
export function bundledManagedTopodVersion(target: TopodTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeTopodArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof TopodHostUnsupportedError ||
        error instanceof TopodArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledTopodVersionsForTests(): void {
  bundledVersions.clear()
}
