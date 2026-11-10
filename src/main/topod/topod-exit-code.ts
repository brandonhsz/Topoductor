import { TopodBindAddressError } from '../../shared/topod-bind-address'
import { TopodBundledRuntimeError } from './topod-bundled-runtime'
import { TopodInstanceLockError } from './topod-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access-error'
import { TOPOD_EXIT_CONFIGURATION } from './topod-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'
import { TOPOD_EXIT_TERMINALS_NOT_DURABLE } from '../../shared/serve-supervised-terminal-durability'
import { TopodTerminalsNotDurableError } from './topod-serve-supervision'

export const TOPOD_EXIT_FAILED = 1

export function resolveTopodExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof TopodInstanceLockError &&
    error.code === 'topod_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  if (error instanceof TopodTerminalsNotDurableError) {
    return TOPOD_EXIT_TERMINALS_NOT_DURABLE
  }
  return error instanceof TopodInstanceLockError ||
    error instanceof TopodBindAddressError ||
    error instanceof TopodBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? TOPOD_EXIT_CONFIGURATION
    : TOPOD_EXIT_FAILED
}
