/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  TopodManagedPastLiveTerminals,
  TopodManagedCancelStopResult,
  TopodManagedDeployResult,
  TopodManagedForgetResult,
  TopodManagedRecoveryResult,
  TopodManagedRollbackResult,
  TopodManagedRuntimeStatus,
  TopodManagedStopResult
} from '../../../../shared/topod-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<TopodManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: TopodManagedPastLiveTerminals
  ) => Promise<TopodManagedDeployResult>
  rollback: (selector: string) => Promise<TopodManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<TopodManagedRecoveryResult>
  stop: (selector: string) => Promise<TopodManagedStopResult>
  cancelStop: (selector: string) => Promise<TopodManagedCancelStopResult>
  forget: (selector: string) => Promise<TopodManagedForgetResult>
  /** Forget only while another saved entry still manages the same server. */
  forgetRedundant: (selector: string) => Promise<TopodManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
