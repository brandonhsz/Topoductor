import type { TopoRuntimeService } from '../../topo-runtime'

export type FederationRuntime = Pick<
  TopoRuntimeService,
  | 'syncOrchestrationFederatedDispatch'
  | 'getOrchestrationDb'
  | 'resolveOrchestrationWorkerServer'
  | 'callOrchestrationWorkerServer'
  | 'notifyMessageArrived'
  | 'reconcileLegacyWorkerTerminals'
>
