import type { TopoRuntimeWithGetPtyRecordForPaneKey } from '../../mailbox/routing/terminal-pane-mail-routing'
import { escalateChatWorkerError } from './chat-worker-error-escalation'
import type { StructuredAgentSessionRequestFailure } from '../../../../native-chat/agent-session-wire/observations/structured-agent-session-request-failures'
import { RuntimeStructuredAgentHost } from '../../../agent-session/installation/runtime-structured-agent-host'

export abstract class RuntimeChatWorkerEvents extends RuntimeStructuredAgentHost {
  abstract onStructuredSessionStatusForMail(
    ...args: Parameters<TopoRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  ): ReturnType<TopoRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>

  abstract onStructuredSessionTabHidden(
    ...args: Parameters<TopoRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>
  ): ReturnType<TopoRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>

  abstract structuredChatMailOwed(
    ...args: Parameters<TopoRuntimeWithGetPtyRecordForPaneKey['structuredChatMailOwed']>
  ): ReturnType<TopoRuntimeWithGetPtyRecordForPaneKey['structuredChatMailOwed']>

  /** A chat worker whose request settled failed tells the Run that dispatched it. */
  onStructuredRequestFailureForErrorMail(failure: StructuredAgentSessionRequestFailure): void {
    void escalateChatWorkerError(failure, this.workerTurnStopReportDeps)
  }
}
