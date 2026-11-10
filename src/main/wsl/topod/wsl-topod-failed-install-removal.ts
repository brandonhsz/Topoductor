/** A slot this connect uploaded whose candidate then failed its start check is deleted, so the next connect re-uploads it instead of relaunching the same broken bytes. */
import { readTopodActivationRecord } from '../../managed-server/activation/topod-activation-record-store'
import { topodGcPinnedDirNames } from '../../managed-server/activation/topod-activation-record'
import {
  probeTopodSlotReadiness,
  provenLiveDaemonVersion
} from '../../managed-server/lifecycle/topod-managed-version-gc'
import { withTopodActivationLock } from '../../managed-server/activation/topod-activation-lock'
import { removeRemoteInstallVersionDir } from '../../managed-server/install/remote-install-gc'
import {
  TOPOD_INSTALL_MODEL,
  remoteInstallDirName
} from '../../managed-server/install/remote-install-model'
import { readTopodGcTransactionPins } from '../../managed-server/activation/topod-gc-transaction-pins'
import {
  topodSlotDir,
  type TopodSlotOptions
} from '../../managed-server/activation/topod-recovery-slot'
import type { TopodDeployResult } from '../../managed-server/install/topod-remote-deploy'
import { isWslTopodSlotInUse } from './wsl-topod-slot-process-probe'

export async function removeFailedFreshWslTopodInstall(
  slot: TopodSlotOptions,
  deployed: TopodDeployResult
): Promise<void> {
  if (
    deployed.outcome !== 'installed-not-activated' ||
    !deployed.startCheckFailed ||
    !deployed.freshlyInstalled
  ) {
    return
  }
  const version = deployed.fullVersion
  try {
    // Under the activation fence, so no activator can preflight or launch this slot meanwhile.
    const outcome = await withTopodActivationLock(
      slot,
      async () => {
        if (!(await mayRemove(slot, version))) {
          return 'pinned'
        }
        const removed = await removeRemoteInstallVersionDir(
          slot.conn,
          TOPOD_INSTALL_MODEL,
          topodSlotDir(slot, version),
          slot.host,
          { isDirLive: (dir) => isWslTopodSlotInUse(slot, dir) }
        )
        return removed ? 'removed' : 'in-use'
      },
      () => 'fenced'
    )
    console.warn(
      outcome === 'removed'
        ? `[wsl-topod] Removed topod ${version}, which failed its start check after install.`
        : `[wsl-topod] Kept failed topod ${version} (${outcome}): it may still be in use.`
    )
  } catch (error) {
    // The connect already failed; a cleanup error must not replace its reason.
    console.warn(`[wsl-topod] Could not remove failed topod ${version}:`, error)
  }
}

/** The GC's pins: active, rollback target, the active daemon's build and any journaled slot. */
async function mayRemove(slot: TopodSlotOptions, version: string): Promise<boolean> {
  const dirName = remoteInstallDirName(TOPOD_INSTALL_MODEL, version)
  const record = await readTopodActivationRecord(slot)
  // Nothing active serves terminals; a daemon the rejected candidate left here is caught by the process probe.
  const liveDaemonVersion = record.active
    ? provenLiveDaemonVersion(await probeTopodSlotReadiness(slot, record.active))
    : null
  if (liveDaemonVersion === undefined) {
    return false
  }
  if (topodGcPinnedDirNames(record, liveDaemonVersion).includes(dirName)) {
    return false
  }
  const transaction = await readTopodGcTransactionPins(slot, { callerHoldsFence: true })
  return transaction.state === 'pinned' && !transaction.dirNames.includes(dirName)
}
