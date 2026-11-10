import {
  provenLiveDaemonVersion,
  pruneManagedTopodVersions,
  type ManagedTopodPruneArgs
} from '../../managed-server/lifecycle/topod-managed-version-gc'

// Only activating another version or a daemon change makes a dir stale; until then a clean GC stays clean.
// A distro shared with another Topo, or a rolled-back activation, can leave a stale dir until the next launch.
const cleanHosts = new Set<string>()

/** Skips version GC on reconnects (distro restarts) after one left nothing behind under the same pins. */
export async function pruneWslTopodVersionsUntilClean(
  environmentId: string,
  args: ManagedTopodPruneArgs,
  prune: (args: ManagedTopodPruneArgs) => Promise<boolean> = pruneManagedTopodVersions
): Promise<void> {
  const key = JSON.stringify([
    environmentId,
    args.slot.remoteHome,
    args.activeVersion,
    provenLiveDaemonVersion(args.readiness) ?? null
  ])
  if (cleanHosts.has(key)) {
    return
  }
  if (await prune(args)) {
    cleanHosts.add(key)
  }
}

export function resetWslTopodVersionGcMemoForTests(): void {
  cleanHosts.clear()
}
