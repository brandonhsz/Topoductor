import { stripCredentialsFromMessage } from './git/remotes/git-remote-error'
import type { TopoVmRecipe } from './topo-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: TopoVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
