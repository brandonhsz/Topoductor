import type {
  AvenaPMConnectionStatus,
  AvenaPMListTasksArgs,
  AvenaPMListTasksResult
} from '../../shared/avenapm/avenapm-types'

export type AvenaPMApi = {
  status: () => Promise<AvenaPMConnectionStatus>
  /** Opens the AvenaPM Google sign-in in the system browser; resolves once Topo holds a token. */
  connect: () => Promise<AvenaPMConnectionStatus>
  cancelConnect: () => Promise<void>
  disconnect: () => Promise<AvenaPMConnectionStatus>
  listTasks: (args?: AvenaPMListTasksArgs) => Promise<AvenaPMListTasksResult>
}
