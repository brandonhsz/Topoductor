import type { SshTarget } from '../../../shared/ssh-types'
import type { WslTopodHostTarget } from '../../wsl/topod/wsl-topod-host-target'
import type { RemoteInstallTransport } from './remote-install-transport'
import type { TopodLaunchDetach } from './topod-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type TopodHostTarget = SshTarget | WslTopodHostTarget

export function isWslTopodHostTarget(target: TopodHostTarget): target is WslTopodHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type TopodHostTransport = RemoteInstallTransport & {
  getTarget(): TopodHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly topodLaunchDetach?: TopodLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly topodLaunchEnv?: (
    launch: TopodLaunchEnvRequest
  ) => Promise<readonly TopodLaunchEnvEntry[]>
}

/** The slot being launched; entries only its own build understands must check the version. */
export type TopodLaunchEnvRequest = { readonly fullVersion: string }

/** `keep-existing` applies the value only when the launching shell has none, so a user's own setting wins. */
export type TopodLaunchEnvEntry = readonly [name: string, value: string, mode?: 'keep-existing']
