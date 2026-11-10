import { TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../../shared/topod-migration/topod-migration-source-kind'
import type { SshTarget } from '../../../shared/ssh-types'
import { collectTopodMigrationSourceCatalog } from '../../persistence/migrating-topod-catalog/topod-source-catalog'
import type { Store } from '../../persistence/loading-store/store'
import { createTopodMigrationManifest } from '../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import { IDENTITY_TOPOD_MIGRATION_PATH_REWRITER } from '../../persistence/migrating-topod-catalog/path-rewrite/topod-migration-path-rewrite'
import type {
  TopodMigrationSource,
  TopodMigrationSourceCutoverPort
} from '../../managed-server/migration/cutover/topod-migration-source'
import { assertTopodMigrationSourceUnchanged } from './topod-migration-source-assertions'
import {
  fenceTopodMigrationSource,
  releaseTopodMigrationFence,
  resolveTopodMigrationFence
} from './topod-migration-source-fence'
import {
  assessTopodMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './topod-migration-terminal-gate'
import type { SshTargetTopodClaims } from '../targets/ssh-target-topod-claims'
import type { TopodMigrationPreflightStore } from '../targets/ssh-target-topod-preflight'
import type { TopodMigrationPaneLeasePredicate } from './topod-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: TopodMigrationPreflightStore
  claims: SshTargetTopodClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => TopodMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): TopodMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertTopodMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseTopodMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: TopodMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: TopodMigrationPaneLeasePredicate
  }
): TopodMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectTopodMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createTopodMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_TOPOD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessTopodMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveTopodMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceTopodMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
