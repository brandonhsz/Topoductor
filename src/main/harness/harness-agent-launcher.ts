import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { tuiAgentDisplayName } from '../../shared/agent-launch/catalog/tui-agent-display-names'
import { canonicalAgentSessionDigest } from '../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import {
  structuredAgentSessionMessageSendMutation,
  structuredAgentSessionSendBody
} from '../../shared/agent-session/requests/structured-agent-session-send-mutation'
import type { HarnessAgentSessionRef } from '../../shared/harness/harness-run-types'
import type { AutomationRunCompletionObservation } from '../automations/run-completion-watcher'
import { observeChatPromptReply } from '../automations/runtime-chat-run-observer'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { launchAgentOnHost } from '../runtime/rpc/methods/agent-launch/agent-launch'
import { structuredAgentRuntimeMetadata } from '../runtime/agent-session/installation/structured-agent-runtime-metadata'
import { rpcCallerOperationKey } from '../runtime/rpc/rpc-caller-identity'
import type { TopoRuntimeService } from '../runtime/topo-runtime'

const REPLY_DEADLINE_MS = 6 * 60 * 60 * 1000
const HARNESS_CALLER = { kind: 'local-cli' } as const

export type HarnessAgentLaunchRequest = {
  stepId: string
  agent: TuiAgent
  worktreeId: string
  prompt: string
  /** A chat from an earlier visit; `resumePrompt` goes there instead of a new session. */
  resume: HarnessAgentSessionRef | null
  resumePrompt: string
}

export type HarnessAgentReply = { ok: true; text: string } | { ok: false; error: string }

/** Starts the agent in the background and reports its session before the reply arrives. */
export type HarnessAgentLauncher = (
  request: HarnessAgentLaunchRequest,
  onSession: (session: HarnessAgentSessionRef) => void,
  signal: AbortSignal
) => Promise<HarnessAgentReply>

function operationId(stepId: string, purpose: string): string {
  const entropy = canonicalAgentSessionDigest({ domain: `harness:${purpose}`, stepId }).slice(0, 32)
  return `${Date.now()}-${entropy}`
}

function replyOf(
  observation: AutomationRunCompletionObservation,
  agentName: string
): HarnessAgentReply {
  return observation.status === 'completed'
    ? { ok: true, text: observation.outputSnapshot?.content ?? '' }
    : { ok: false, error: observation.error ?? `${agentName} did not finish its turn.` }
}

/** Null when the chat cannot take another message, so the caller starts a new one. */
async function sendToExistingChat(
  runtime: TopoRuntimeService,
  sessionId: string,
  request: HarnessAgentLaunchRequest
): Promise<string | null> {
  try {
    const store = await runtime.openAgentSessionRecordStore()
    await runtime.ensureStructuredAgentSessionHost()
    const host = getStructuredAgentSessionHost()
    const conversation = store.getConversation(sessionId)
    if (!host || !conversation || conversation.provider !== request.agent) {
      return null
    }
    const messageId = operationId(request.stepId, 'resume')
    const sent = await host.send(
      { callerKey: rpcCallerOperationKey(HARNESS_CALLER) },
      structuredAgentSessionMessageSendMutation({
        sessionId,
        clientOperationId: messageId,
        expectedRuntimeFence: conversation.currentFence,
        delivery: 'queue-if-active',
        body: structuredAgentSessionSendBody(request.resumePrompt, [])
      })
    )
    return sent.ok ? messageId : null
  } catch {
    return null
  }
}

export function createHarnessAgentLauncher(runtime: TopoRuntimeService): HarnessAgentLauncher {
  const terminalObserver = createRuntimeAutomationRunTerminalObserver(runtime)
  return async (request, onSession, signal) => {
    const agentName = tuiAgentDisplayName(request.agent) ?? request.agent
    const observeChat = async (sessionId: string, messageId: string) =>
      replyOf(
        await observeChatPromptReply(
          runtime,
          { sessionId, messageId, agent: agentName, deadlineAt: Date.now() + REPLY_DEADLINE_MS },
          signal
        ),
        agentName
      )
    if (request.resume?.kind === 'structured') {
      const messageId = await sendToExistingChat(runtime, request.resume.sessionId, request)
      if (messageId) {
        onSession(request.resume)
        return observeChat(request.resume.sessionId, messageId)
      }
    }
    const result = await launchAgentOnHost(
      {
        agent: request.agent,
        operationId: operationId(request.stepId, 'step'),
        // Chat-capable agents prefer a chat so the reply comes from the transcript, not the screen.
        nativeChatDefault: structuredAgentRuntimeMetadata(request.agent) !== null,
        presentation: 'background',
        prompt: { text: request.prompt, delivery: 'submit' },
        target: { kind: 'existing', worktree: `id:${request.worktreeId}` }
      },
      { runtime, caller: HARNESS_CALLER }
    )
    const { outcome } = result
    if (outcome.kind === 'structured') {
      onSession({ kind: 'structured', worktreeId: result.worktreeId, sessionId: outcome.sessionId })
      if (result.prompt?.outcome !== 'journaled') {
        return { ok: false, error: `${agentName} started, but Topo could not confirm the prompt.` }
      }
      return observeChat(outcome.sessionId, result.prompt.messageId)
    }
    onSession({
      kind: 'terminal',
      worktreeId: result.worktreeId,
      paneKey: outcome.paneKey ?? null,
      handle: outcome.handle
    })
    if (result.prompt?.outcome !== 'handed-to-terminal') {
      return { ok: false, error: `${agentName} started, but Topo could not confirm the prompt.` }
    }
    return replyOf(await terminalObserver.observeCompletion(outcome.handle, { signal }), agentName)
  }
}
