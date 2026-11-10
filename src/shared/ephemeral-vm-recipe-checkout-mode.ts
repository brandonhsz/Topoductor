import { getEphemeralVmRecipeResultCheckoutMode } from './ephemeral-vm-recipes'
import type { EphemeralVmRecipeResult } from './ephemeral-vm-recipes'
import type { TopoVmRecipe } from './topo-yaml-hook-types'
import { ephemeralVmFailure, type EphemeralVmFailure } from './ephemeral-vm-failure-copy'

export function getEphemeralVmRecipeResultSchemaVersion(recipe: TopoVmRecipe): 1 | 2 {
  return recipe.checkoutMode === 'provisioned-root' ? 2 : 1
}

export function getEphemeralVmRecipeCheckoutModeFailure(
  recipe: TopoVmRecipe,
  result: EphemeralVmRecipeResult
): EphemeralVmFailure | null {
  const configuredMode = recipe.checkoutMode ?? 'orca-worktree'
  const resultMode = getEphemeralVmRecipeResultCheckoutMode(result)
  if (configuredMode === resultMode) {
    return null
  }
  return ephemeralVmFailure(
    configuredMode === 'provisioned-root'
      ? 'provisionedRootResultRequired'
      : 'provisionedRootNotConfigured'
  )
}
