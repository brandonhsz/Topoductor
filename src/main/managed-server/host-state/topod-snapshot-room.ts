/** Check snapshot room before stopping a serving incumbent (#30491). */
import { topodRemoteBaseDir } from '../install/topod-remote-windows-node'
import { execTopodRemoteOr } from '../install/topod-remote-runtime-control'
import {
  TOPOD_STATE_SNAPSHOT_DIR,
  type TopodActivationRecord
} from '../activation/topod-activation-record'
import {
  topodSnapshotShortfallKb,
  topodSnapshotShortfallMessage,
  topodSnapshotSpaceCommand,
  parseTopodSnapshotSpace
} from './topod-state-snapshot-space'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import type { TopodSlotOptions } from '../activation/topod-recovery-slot'

export const TOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'topod_snapshot_space_insufficient'

export function topodSnapshotsRoot(options: Pick<TopodSlotOptions, 'host' | 'remoteHome'>): string {
  return joinRemotePath(
    options.host,
    topodRemoteBaseDir(options.host, options.remoteHome),
    TOPOD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function topodSnapshotRoomRefusal(
  options: TopodSlotOptions,
  record: TopodActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = topodRemoteBaseDir(options.host, options.remoteHome)
  const command = topodSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    topodSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseTopodSnapshotSpace(await measureRoom(options, command))
  const shortfall = topodSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? topodSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: TopodSlotOptions, command: string): Promise<string> {
  try {
    return await execTopodRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
