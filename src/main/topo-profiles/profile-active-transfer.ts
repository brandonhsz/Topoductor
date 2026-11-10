import type {
  TransferTopoProfileProjectArgs,
  TransferTopoProfileProjectResult
} from '../../shared/topo-profiles'
import type { Store } from '../persistence/loading-store/store'
import { transferTopoProfileProject } from './profile-project-transfer'
import { hasTopoProfileStateDatabase } from './profile-storage-paths'
import { profileHasPendingProjectMove } from './profile-project-move-intent'
import { flushActiveProfileBeforeFileMutation } from './profile-persistence-deadline'

/** Keep the active Store stopped until file mutation either succeeds or proves unchanged. */
export async function transferActiveProfileProject(
  args: TransferTopoProfileProjectArgs,
  userDataPath: string,
  store: Pick<Store, 'beginProfileMaintenance'>,
  reopenSource: () => Promise<void>
): Promise<TransferTopoProfileProjectResult> {
  const hadDatabase = hasTopoProfileStateDatabase(args.sourceProfileId, userDataPath)
  const pendingMove = profileHasPendingProjectMove(args.sourceProfileId, userDataPath)
  const maintenance = await flushActiveProfileBeforeFileMutation(store, { flush: !pendingMove })
  let result: TransferTopoProfileProjectResult
  try {
    if (profileHasPendingProjectMove(args.sourceProfileId, userDataPath)) {
      throw new Error('active_source_topo_profile_move_requires_recovery')
    }
    result = transferTopoProfileProject(args, userDataPath)
  } catch (error) {
    const needsRecovery =
      (!hadDatabase && hasTopoProfileStateDatabase(args.sourceProfileId, userDataPath)) ||
      profileHasPendingProjectMove(args.sourceProfileId, userDataPath)
    // Further writes would invalidate a retained move's recovery revision.
    await (needsRecovery ? reopenSource() : maintenance.resume())
    throw error
  }
  if (result.status !== 'transferred' || args.mode !== 'move') {
    await maintenance.resume()
  }
  return result
}
