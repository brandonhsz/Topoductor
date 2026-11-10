import type { SshTarget } from '../../../shared/ssh-types'
import { RUNTIME_OWNED_SSH_TARGET_ID_PREFIX } from '../../../shared/execution-host'

export function getRuntimeOwnedSshTargetId(runtimeId: string): string {
  return `${RUNTIME_OWNED_SSH_TARGET_ID_PREFIX}${runtimeId}`
}

/** Any target Topo created as an implementation detail; hidden from SSH-host surfaces. */
export function isRuntimeOwnedSshTarget(target: SshTarget): boolean {
  return target.owner !== undefined
}

/** A host serving (or being set up for) a managed Topo server: visible, but never a direct relay. */
export function isManagedTopodSshTarget(target: SshTarget): boolean {
  return target.topodFence !== undefined || target.topodProvisioning !== undefined
}

/** Managed hosts cannot serve direct relays unless older retained projects still require their previous relay. */
export function allowsDirectSshRelay(target: SshTarget): boolean {
  if (target.topodProvisioning) {
    return false
  }
  return !target.topodFence || target.topodFence.sourceChangedAt !== undefined
}
