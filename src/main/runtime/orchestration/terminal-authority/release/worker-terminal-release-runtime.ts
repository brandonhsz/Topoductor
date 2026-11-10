import type { TopoRuntimeService } from '../../../topo-runtime'
import type { StructuredSessionSurfaceRuntime } from '../../../agent-session/structured-agent-session-close'

export type WorkerTerminalReleaseRuntime = StructuredSessionSurfaceRuntime &
  Pick<
    TopoRuntimeService,
    | 'forgetStructuredSessionMail'
    | 'resolveOrchestrationWorkerServer'
    | 'callOrchestrationWorkerServer'
    | 'getOrchestrationFleetAgentStatusSnapshot'
    | 'getOrchestrationDb'
    | 'showTerminal'
    | 'resolveTerminalHandleByProcessIncarnation'
    | 'getTerminalPaneKey'
    | 'getTerminalProcessIncarnation'
    | 'getTerminalLivenessVerdict'
    | 'checkTerminalAgentPresence'
    | 'getOrchestrationDispatchAuthority'
    | 'ensureStructuredAgentSessionHost'
    | 'inspectTerminalProcessIncarnationLiveness'
    | 'closeTerminal'
    | 'getExactWorkerProviderSession'
    | 'readTerminal'
    | 'notifyMessageArrived'
    | 'isWorkerAgentInTurn'
  >
