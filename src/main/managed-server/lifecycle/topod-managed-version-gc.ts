import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import {
  topodSlotDir,
  resolveTopodSlotIdentity,
  type TopodSlotOptions
} from '../activation/topod-recovery-slot'
import { probeActiveTopodReadiness } from '../activation/topod-active-readiness'
import { gcOldTopodVersions } from '../install/topod-remote-gc'
import { nodeRuntimeStorePins } from '../install/pinned-runtime-host-target'

/** null proves no daemon; undefined means its version is unknown. */
export function provenLiveDaemonVersion(readiness: ServeReadiness): string | null | undefined {
  const daemon = readiness.health?.terminalDaemon
  if (daemon?.state === 'live' && daemon.buildVersion) {
    return daemon.buildVersion
  }
  return daemon?.state === 'absent' ? null : undefined
}

export type ManagedTopodPruneArgs = {
  slot: TopodSlotOptions
  serverTarget: NodeRuntimeTarget
  activeVersion: string
  readiness: ServeReadiness
  keepStagedWithinDays?: number
}

/** True only when GC ran and left no stale version dir behind. */
export async function pruneManagedTopodVersions(args: ManagedTopodPruneArgs): Promise<boolean> {
  const liveDaemonVersion = provenLiveDaemonVersion(args.readiness)
  // Unknown daemon versions could still execute from any candidate tree; skip GC.
  if (liveDaemonVersion === undefined) {
    return false
  }
  try {
    return await gcOldTopodVersions({
      conn: args.slot.conn,
      host: args.slot.host,
      remoteHome: args.slot.remoteHome,
      currentDirAbsPath: topodSlotDir(args.slot, args.activeVersion),
      record: await readTopodActivationRecord(args.slot),
      liveDaemonVersion,
      // Default and compat builds share one runtime store.
      nodeRuntimePins: nodeRuntimeStorePins(args.serverTarget),
      ...(args.keepStagedWithinDays !== undefined
        ? { keepStagedWithinDays: args.keepStagedWithinDays }
        : {}),
      signal: args.slot.signal
    })
  } catch (error) {
    // Cleanup must not fail completed deploys; later connects retry.
    console.warn('[topod-gc] Pruning old topod versions failed:', error)
    return false
  }
}

/** GC otherwise runs only after an activation, so each deferred release left its staged slot behind (#34149). */
export async function pruneSupersededTopodCandidates(
  slot: TopodSlotOptions,
  serverTarget: NodeRuntimeTarget,
  candidateVersion: string
): Promise<void> {
  let readiness: ServeReadiness
  try {
    const active = (await readTopodActivationRecord(slot)).active
    if (!active) {
      return
    }
    readiness = await probeTopodSlotReadiness(slot, active)
  } catch (error) {
    // Without the incumbent's daemon version a staged tree may still be executing.
    console.warn('[topod-gc] Skipped pruning staged topod versions:', error)
    return
  }
  await pruneManagedTopodVersions({
    slot,
    serverTarget,
    activeVersion: candidateVersion,
    readiness,
    keepStagedWithinDays: STAGED_BUILD_KEEP_DAYS
  })
}

/** Readiness of the topod serving `version`, which names its live terminal daemon's build. */
export async function probeTopodSlotReadiness(
  slot: TopodSlotOptions,
  version: string
): Promise<ServeReadiness> {
  const identity = await resolveTopodSlotIdentity(slot, version)
  return probeActiveTopodReadiness(
    { ...slot, remoteInstallDir: identity.remoteDir },
    { buildHash: identity.buildHash, fullVersion: identity.version }
  )
}

// Desktops on different releases share hosts; without a grace period each re-uploads what the other pruned.
const STAGED_BUILD_KEEP_DAYS = 3
