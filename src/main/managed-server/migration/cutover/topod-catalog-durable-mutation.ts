import type { TopodMigrationCatalogState } from '../../../../shared/topod-migration/topod-migration-manifest'

export async function resolveDurableTopodCatalogMutation(
  mutate: () => Promise<TopodMigrationCatalogState>,
  read: () => Promise<TopodMigrationCatalogState>,
  accepted: (state: TopodMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: TopodMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
