import { buildHarnessAgentPrompt, parseOutcome } from '../../shared/harness/harness-agent-prompt'
import { resolveChatRunner } from '../../shared/harness/harness-subagent-contract'
import type { HarnessAgentSessionRef, HarnessRunStep } from '../../shared/harness/harness-run-types'
import type { HarnessAgentLauncher } from './harness-agent-launcher'
import {
  HarnessRunStopped,
  RETRY,
  SKIP,
  STOP,
  type AgentStepRequest,
  type AgentStepResult,
  type HarnessStepRuntime
} from './harness-step-runtime'

export type HarnessAgentStepContext = {
  rt: HarnessStepRuntime
  launch: HarnessAgentLauncher
  signal: AbortSignal
  /** Chats kept per `sessionKey` so later visits continue them. */
  sessions: Map<string, HarnessAgentSessionRef>
}

const MAX_HISTORY_LINES = 200

/** One line per finished step, so a reflect node sees retries, failures and decisions. */
export function appendHistory(history: string | undefined, step: HarnessRunStep): string {
  const parts = [
    `${step.title} (ronda ${step.visit})`,
    step.status === 'failed' ? `FALLÓ: ${step.error ?? ''}` : step.status,
    step.outcome ? `→ ${step.outcome}` : ''
  ].filter(Boolean)
  const lines = [...(history ? history.split('\n') : []), `- ${parts.join(' · ')}`]
  return lines.slice(-MAX_HISTORY_LINES).join('\n')
}

function assertRunning(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new HarnessRunStopped()
  }
}

/** The chat already has the flow's rules and project data in its instructions, so a task carries only the step. */
async function handToChat(
  rt: HarnessStepRuntime,
  request: AgentStepRequest
): Promise<AgentStepResult> {
  const { run } = rt
  const step = rt.addStep({
    nodeId: request.nodeId,
    taskId: request.taskId,
    title: request.title,
    agent: null,
    status: 'running',
    runner: 'chat'
  })
  if (run.chatSessionId && !run.chatSessionId.startsWith('terminal:')) {
    step.session = { kind: 'structured', worktreeId: run.worktreeId, sessionId: run.chatSessionId }
  }
  const instructions = buildHarnessAgentPrompt({
    ...request,
    flow: { ...run.flow, sharedInstructions: '', project: { ...run.flow.project, notes: '' } },
    visit: step.visit
  })
  const done = await rt.awaitChat(step, {
    nodeId: request.nodeId,
    taskId: request.taskId,
    title: request.title,
    instructions,
    choices: request.choices,
    allowEdits: request.allowEdits
  })
  const outcome =
    done.outcome && request.choices.includes(done.outcome)
      ? done.outcome
      : parseOutcome(done.output, request.choices)
  rt.finishStep(step, { status: 'done', output: done.output, outcome })
  return { step, output: done.output, outcome }
}

/** The chat launches the step as its own subagent with the full prompt; Topo keeps the subagent's raw reply. */
async function handToSubagent(
  rt: HarnessStepRuntime,
  request: AgentStepRequest
): Promise<AgentStepResult> {
  const step = rt.addStep({
    nodeId: request.nodeId,
    taskId: request.taskId,
    title: request.title,
    agent: null,
    status: 'running',
    runner: 'subagent'
  })
  const done = await rt.awaitChat(step, {
    nodeId: request.nodeId,
    taskId: request.taskId,
    title: request.title,
    instructions: buildHarnessAgentPrompt({ ...request, flow: rt.run.flow, visit: step.visit }),
    choices: request.choices,
    allowEdits: request.allowEdits,
    delivery: 'subagent'
  })
  const outcome = parseOutcome(done.output, request.choices)
  rt.finishStep(step, { status: 'done', output: done.output, outcome })
  return { step, output: done.output, outcome }
}

/** Runs one agent turn; on failure the person retries, skips (null) or stops the run. */
export async function runHarnessAgentStep(
  { rt, launch, signal, sessions }: HarnessAgentStepContext,
  request: AgentStepRequest
): Promise<AgentStepResult | null> {
  if (rt.run.mode === 'chat') {
    const runner =
      request.runner === 'subagent'
        ? resolveChatRunner(request, await rt.chatProvider())
        : request.runner
    assertRunning(signal)
    if (runner === 'chat') {
      return handToChat(rt, request)
    }
    if (runner === 'subagent') {
      return handToSubagent(rt, request)
    }
  }
  const agent = request.agent ?? rt.run.flow.defaultAgent
  for (;;) {
    assertRunning(signal)
    const step = rt.addStep({
      nodeId: request.nodeId,
      taskId: request.taskId,
      title: request.title,
      agent,
      status: 'running',
      runner: 'topo',
      allowEdits: request.allowEdits
    })
    const promptInput = { ...request, flow: rt.run.flow, visit: step.visit }
    const resume = request.sessionKey ? (sessions.get(request.sessionKey) ?? null) : null
    let error: string
    try {
      const reply = await launch(
        {
          stepId: step.id,
          agent,
          worktreeId: rt.run.worktreeId,
          prompt: buildHarnessAgentPrompt(promptInput),
          resume,
          resumePrompt: buildHarnessAgentPrompt({ ...promptInput, continuing: true }),
          withoutTab: rt.run.mode === 'chat'
        },
        (session) => {
          step.session = session
          if (request.sessionKey && session.kind === 'structured') {
            sessions.set(request.sessionKey, session)
          }
          rt.touch()
        },
        signal
      )
      assertRunning(signal)
      if (reply.ok) {
        const outcome = parseOutcome(reply.text, request.choices)
        rt.finishStep(step, { status: 'done', output: reply.text, outcome })
        return { step, output: reply.text, outcome }
      }
      error = reply.error
    } catch (caught) {
      assertRunning(signal)
      error = caught instanceof Error ? caught.message : String(caught)
    }
    rt.finishStep(step, { status: 'failed', error })
    const answer = await rt.ask(step, {
      title: request.title,
      reason: 'human',
      prompt: `El agente falló: ${error}`,
      context: [],
      choices: [RETRY, SKIP, STOP],
      fields: []
    })
    if (answer.choice === STOP) {
      rt.stopRun()
    }
    if (answer.choice === SKIP) {
      return null
    }
  }
}
