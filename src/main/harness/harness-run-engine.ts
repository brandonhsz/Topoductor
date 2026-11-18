import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { edgeFires } from '../../shared/harness/harness-agent-prompt'
import type { HarnessSubagentResult } from '../../shared/harness/harness-subagent-contract'
import type { HarnessNode } from '../../shared/harness/harness-flow-types'
import type {
  HarnessAgentSessionRef,
  HarnessChatCompletion,
  HarnessDecisionAnswer,
  HarnessPendingDecision,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'
import type { HarnessAgentLauncher } from './harness-agent-launcher'
import {
  confirmExtraVisit,
  redirectOnLimit,
  type HarnessRoute,
  executeAgentNode,
  executeHumanNode,
  executeStartNode
} from './harness-node-executors'
import {
  HarnessRunStopped,
  type AgentStepRequest,
  type AgentStepResult,
  type HarnessChatTaskRequest,
  type HarnessDecisionRequest,
  type HarnessStepRuntime
} from './harness-step-runtime'
import { executeWavesNode } from './harness-wave-executor'
import { appendHistory, runHarnessAgentStep } from './harness-agent-step'
import { HarnessChatInbox } from './harness-chat-inbox'

const FINISHED: ReadonlySet<HarnessRun['status']> = new Set(['completed', 'failed', 'stopped'])

export type HarnessRunEngineDeps = {
  launch: HarnessAgentLauncher
  onChange: (run: HarnessRun) => void
  /** Agent of the run's chat; without it `subagent` steps fall back to Topo's own agents. */
  chatProvider?: (run: HarnessRun) => Promise<TuiAgent | null>
  /** Stops an agent session the run started; nobody else would stop a session with no tab. */
  closeSession?: (session: HarnessAgentSessionRef) => void
}

/** Walks one run's graph: fans out on unlabeled edges, joins on `joinAll`, pauses on people. */
export class HarnessRunEngine implements HarnessStepRuntime {
  private readonly controller = new AbortController()
  private readonly active = new Map<string, number>()
  private readonly joinWaiting = new Set<string>()
  private readonly visits = new Map<string, number>()
  private readonly sessions = new Map<string, HarnessAgentSessionRef>()
  private readonly waiters = new Map<
    string,
    { resolve: (answer: HarnessDecisionAnswer) => void; reject: (error: Error) => void }
  >()
  private readonly chatInbox: HarnessChatInbox
  private stepCounter = 0
  private decisionCounter = 0

  constructor(
    readonly run: HarnessRun,
    private readonly deps: HarnessRunEngineDeps
  ) {
    this.chatInbox = new HarnessChatInbox(run, () => this.touch())
  }

  start(): void {
    const start = this.run.flow.nodes.find((node) => node.kind === 'start')
    if (!start) {
      this.fail('El flujo no tiene nodo de inicio.')
      return
    }
    this.activate(start.id)
  }

  answer(answer: HarnessDecisionAnswer): void {
    const waiter = this.waiters.get(answer.decisionId)
    if (!waiter) {
      return
    }
    this.waiters.delete(answer.decisionId)
    this.run.pending = this.run.pending.filter((decision) => decision.id !== answer.decisionId)
    this.touch()
    waiter.resolve(answer)
  }

  stop(): void {
    if (this.isFinished()) {
      return
    }
    this.controller.abort()
    this.closeTablessSessions()
    for (const waiter of this.waiters.values()) {
      waiter.reject(new HarnessRunStopped())
    }
    this.waiters.clear()
    this.chatInbox.cancelAll(new HarnessRunStopped())
    this.run.pending = []
    for (const step of this.run.steps) {
      if (step.status === 'running' || step.status === 'waiting') {
        step.status = 'stopped'
        step.endedAt = Date.now()
      }
    }
    this.run.status = 'stopped'
    this.touch()
  }

  stopRun(): never {
    this.stop()
    throw new HarnessRunStopped()
  }

  touch(): void {
    if (!this.isFinished()) {
      this.run.status = this.run.pending.length > 0 ? 'waiting' : 'running'
    }
    this.run.updatedAt = Date.now()
    this.deps.onChange(this.run)
  }

  addStep(input: Parameters<HarnessStepRuntime['addStep']>[0]): HarnessRunStep {
    const step: HarnessRunStep = {
      ...input,
      id: `${this.run.id}-s${++this.stepCounter}`,
      visit: this.visits.get(input.nodeId) ?? 1,
      session: null,
      output: '',
      outcome: null,
      error: null,
      startedAt: Date.now(),
      endedAt: null
    }
    this.run.steps.push(step)
    this.touch()
    return step
  }

  finishStep(step: HarnessRunStep, patch: Partial<HarnessRunStep>): void {
    Object.assign(step, patch, { endedAt: Date.now() })
    this.run.vars.historial = appendHistory(this.run.vars.historial, step)
    this.touch()
  }

  ask(step: HarnessRunStep, decision: HarnessDecisionRequest): Promise<HarnessDecisionAnswer> {
    this.assertRunning()
    const pending: HarnessPendingDecision = {
      ...decision,
      id: `${this.run.id}-d${++this.decisionCounter}`,
      stepId: step.id,
      nodeId: step.nodeId,
      createdAt: Date.now()
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(pending.id, { resolve, reject })
      this.run.pending.push(pending)
      this.touch()
    })
  }

  awaitChat(step: HarnessRunStep, task: HarnessChatTaskRequest): Promise<HarnessChatCompletion> {
    this.assertRunning()
    return this.chatInbox.open(step, task)
  }

  completeChat(completion: HarnessChatCompletion): boolean {
    return this.chatInbox.complete(completion)
  }

  completeSubagent(prompt: string, output: string): HarnessSubagentResult {
    return this.chatInbox.completeSubagent(prompt, output)
  }

  async chatProvider(): Promise<TuiAgent | null> {
    return this.deps.chatProvider ? this.deps.chatProvider(this.run) : null
  }

  runAgentStep(request: AgentStepRequest): Promise<AgentStepResult | null> {
    return runHarnessAgentStep(
      {
        rt: this,
        launch: this.deps.launch,
        signal: this.controller.signal,
        sessions: this.sessions
      },
      request
    )
  }

  private closeTablessSessions(): void {
    for (const step of this.run.steps) {
      if (step.status !== 'done' && step.session?.kind === 'structured' && step.session.tabless) {
        this.deps.closeSession?.(step.session)
      }
    }
  }

  private isFinished(): boolean {
    return FINISHED.has(this.run.status)
  }

  private assertRunning(): void {
    if (this.controller.signal.aborted) {
      throw new HarnessRunStopped()
    }
  }

  private node(nodeId: string): HarnessNode | undefined {
    return this.run.flow.nodes.find((node) => node.id === nodeId)
  }

  private activate(nodeId: string): void {
    const node = this.node(nodeId)
    if (!node || this.isFinished()) {
      return
    }
    if ('joinAll' in node && node.joinAll) {
      this.joinWaiting.add(nodeId)
      queueMicrotask(() => this.releaseJoins())
      return
    }
    this.launchNode(node)
  }

  private releaseJoins(): void {
    for (const nodeId of this.joinWaiting) {
      const upstreamBusy = this.run.flow.edges.some(
        (edge) => edge.target === nodeId && (this.active.get(edge.source) ?? 0) > 0
      )
      const node = this.node(nodeId)
      if (!upstreamBusy && node) {
        this.joinWaiting.delete(nodeId)
        this.launchNode(node)
      }
    }
    this.settleIfIdle()
  }

  private launchNode(node: HarnessNode): void {
    this.active.set(node.id, (this.active.get(node.id) ?? 0) + 1)
    void this.execute(node)
      .then((route) => {
        this.release(node.id)
        if ('goto' in route) {
          this.activate(route.goto)
        }
        for (const edge of this.run.flow.edges) {
          if (
            'outcome' in route &&
            edge.source === node.id &&
            edgeFires(edge, route.outcome, this.run.vars)
          ) {
            this.activate(edge.target)
          }
        }
        this.releaseJoins()
      })
      .catch((error: unknown) => {
        this.release(node.id)
        if (!(error instanceof HarnessRunStopped)) {
          this.fail(error instanceof Error ? error.message : String(error))
        }
      })
  }

  private release(nodeId: string): void {
    this.active.set(nodeId, Math.max(0, (this.active.get(nodeId) ?? 1) - 1))
  }

  private settleIfIdle(): void {
    if (this.isFinished()) {
      return
    }
    const busy = [...this.active.values()].some((count) => count > 0)
    if (!busy && this.joinWaiting.size === 0 && this.run.pending.length === 0) {
      this.run.status = 'completed'
      this.touch()
    }
  }

  private fail(message: string): void {
    if (this.isFinished()) {
      return
    }
    this.controller.abort()
    this.run.error = message
    this.run.status = 'failed'
    this.touch()
  }

  private async execute(node: HarnessNode): Promise<HarnessRoute> {
    this.assertRunning()
    const visit = (this.visits.get(node.id) ?? 0) + 1
    this.visits.set(node.id, visit)
    if ('maxVisits' in node && visit > node.maxVisits) {
      if (node.limitTarget) {
        // A fresh budget lets the limit target send work back for another full set of attempts.
        this.visits.set(node.id, 0)
        return redirectOnLimit(this, node, node.limitTarget)
      }
      await confirmExtraVisit(this, node)
    }
    return { outcome: await this.executeKind(node, visit) }
  }

  private async executeKind(node: HarnessNode, visit: number): Promise<string | null> {
    switch (node.kind) {
      case 'start':
        return executeStartNode(this, node, visit)
      case 'agent':
        return executeAgentNode(this, node)
      case 'human':
        return executeHumanNode(this, node)
      case 'waves':
        return executeWavesNode(this, node)
      case 'end': {
        const step = this.addStep({
          nodeId: node.id,
          taskId: null,
          title: node.title,
          agent: null,
          status: 'running'
        })
        this.finishStep(step, { status: 'done' })
        return null
      }
    }
  }
}
