/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/ssh-types'
import type { Store } from '../../persistence/loading-store/store'
import type {
  TopodMigrationBlocker,
  TopodMigrationPreflight
} from '../../../shared/topod-migration/topod-migration-preflight'
import {
  createTopodMigrationManifest,
  type TopodMigrationExportStore
} from '../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveTopodPreflightTarget
} from './ssh-target-topod-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-topod-dependents'
import {
  preservesTopodMigrationBridgedPanes,
  type TopodMigrationPaneLeasePredicate
} from '../migration-source/topod-migration-bridged-panes'

export type TopodMigrationPreflightStore = TopodMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectTopodMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightTopodMigrationExport(
  store: TopodMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): TopodMigrationPreflight {
  const resolved = resolveTopodPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: TopodMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to topod; its work must finish first.
    blockers.push({
      code: 'topod_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createTopodMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingTopodMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsTopodMigrationBlockers(
  store: TopodMigrationPreflightStore & Pick<Store, 'createTopodMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: TopodMigrationPaneLeasePredicate
): boolean {
  const view = store.createTopodMigrationLeaveBehindView(targetId)
  const preflight = preflightTopodMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesTopodMigrationBridgedPanes(
      createTopodMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableTopodMigrationBlockers(
  blockers: readonly TopodMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingTopodMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'topod_migration_dependent_state')
  )
}

export function isBlockingTopodMigrationBlocker(blocker: TopodMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'topod_migration_saved_port_forwards'
  )
}
