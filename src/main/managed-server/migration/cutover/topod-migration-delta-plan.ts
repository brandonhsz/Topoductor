/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type {
  TopodDeltaMovePreview,
  TopodDeltaMoveRow
} from '../../../../shared/topod-managed-runtime'
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import { isRetainedTopodMigrationSourceCutover } from '../../../../shared/topod-migration/topod-migration-source-cutover'
import type { TopodMigrationSourceCutover } from '../../../../shared/topod-migration/topod-migration-source-cutover'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { Store } from '../../../persistence/loading-store/store'
import { collectTopodMigrationSourceCatalog } from '../../../persistence/migrating-topod-catalog/topod-source-catalog'
import { listTopodMigrationCutoverChainForTarget } from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  createTopodMigrationManifest,
  topodMigrationCatalogIds,
  type TopodMigrationCatalogIds
} from '../../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import type { TopodMigrationSnapshotSource } from '../transfers/topod-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from '../../../ssh/targets/ssh-target-topod-dependents'
import type { TopodMigrationPreflightStore } from '../../../ssh/targets/ssh-target-topod-preflight'

export type TopodDeltaSourceStore = TopodMigrationPreflightStore & TopodMigrationSnapshotSource

export function unfinishedTopodDelta(
  chain: readonly TopodMigrationSourceCutover[]
): TopodMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedTopodMigrationSourceCutover(head)
    ? head
    : null
}

export function committedTopodMigrationChain(
  chain: readonly TopodMigrationSourceCutover[]
): TopodMigrationSourceCutover[] {
  return (unfinishedTopodDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function topodDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly TopodMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: TopodMigrationManifest
): TopodDeltaSourceStore {
  const ids = topodMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return topodSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function topodSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: TopodMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): TopodDeltaSourceStore {
  const ownedNow = createTopodMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createTopodMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readTopodMigrationSourceSnapshotChunk: (...args) =>
      store.readTopodMigrationSourceSnapshotChunk(...args)
  }
}

export type TopodDeltaMovePlan = TopodDeltaMovePreview & {
  manifest: TopodMigrationManifest
  moved: TopodMigrationSourceCutover[]
  head: TopodMigrationSourceCutover
  resumes: TopodMigrationSourceCutover | null
  source: TopodDeltaSourceStore
}

export function planTopodDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): TopodDeltaMovePlan {
  const environmentId = target.topodFence?.environmentId
  if (!environmentId || !target.topodFence?.sourceChangedAt) {
    throw new Error('topod_delta_not_changed')
  }
  const chain = listTopodMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedTopodDelta(chain)
  const moved = committedTopodMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedTopodMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('topod_delta_no_retained_migration')
  }
  const source = topodDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createTopodMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectTopodMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: TopodMigrationCatalogPayload): TopodDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: TopodMigrationCatalogPayload,
  movedPayloads: readonly TopodMigrationCatalogPayload[]
): TopodDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: TopodDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: TopodDeltaMoveRow[] = []
  const removed: TopodDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: TopodMigrationCatalogPayload, row: TopodDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
