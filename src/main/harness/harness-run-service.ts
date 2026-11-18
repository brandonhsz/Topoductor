import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { HarnessSubagentResult } from '../../shared/harness/harness-subagent-contract'
import type {
  HarnessChatCompletion,
  HarnessDecisionAnswer,
  HarnessRun,
  HarnessRunStartRequest,
  HarnessRunSummary
} from '../../shared/harness/harness-run-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'
import type { HarnessAgentLauncher } from './harness-agent-launcher'
import { harnessChatInstructions } from '../../shared/harness/harness-chat-instructions'
import { getHarnessFlow } from './harness-flow-store'
import { HarnessRunEngine, type HarnessRunEngineDeps } from './harness-run-engine'

const MAX_KEPT_RUNS = 50
const MAX_BYTES = 32 * 1024 * 1024
const PERSIST_DELAY_MS = 500
const INTERRUPTED = 'Topo se cerró mientras esta ejecución corría.'

export function summarizeHarnessRun(run: HarnessRun): HarnessRunSummary {
  return {
    id: run.id,
    flowId: run.flowId,
    flowName: run.flowName,
    worktreeId: run.worktreeId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    pendingCount: run.pending.length,
    mode: run.mode,
    chatSessionId: run.chatSessionId
  }
}

function runsPath(): string {
  return join(getAppEnvironment().getPath('userData'), 'harness-runs.json')
}

function isHarnessRun(value: unknown): value is HarnessRun {
  const record = asRecord(value)
  return (
    typeof record?.id === 'string' &&
    typeof record.worktreeId === 'string' &&
    Array.isArray(record.steps) &&
    Array.isArray(record.pending) &&
    asRecord(record.flow) !== null &&
    asRecord(record.vars) !== null
  )
}

/** Runs that were live when Topo quit cannot be resumed: their agents' replies were never observed. */
async function readPersistedRuns(): Promise<HarnessRun[]> {
  const path = runsPath()
  try {
    if ((await stat(path)).size > MAX_BYTES) {
      return []
    }
    const runs = asRecord(JSON.parse(await readFile(path, 'utf8')))?.runs
    return (Array.isArray(runs) ? runs.filter(isHarnessRun) : []).map((stored) => {
      // Runs saved before chat mode existed were all orchestrated.
      const run: HarnessRun = {
        ...stored,
        mode: stored.mode === 'chat' ? 'chat' : 'orchestrated',
        chatSessionId: typeof stored.chatSessionId === 'string' ? stored.chatSessionId : null,
        chatTasks: []
      }
      return run.status === 'running' || run.status === 'waiting'
        ? { ...run, status: 'stopped', pending: [], error: run.error ?? INTERRUPTED }
        : run
    })
  } catch {
    return []
  }
}

export class HarnessRunService {
  private readonly runs = new Map<string, HarnessRun>()
  private readonly engines = new Map<string, HarnessRunEngine>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(run: HarnessRun) => void>()
  private readonly loaded: Promise<void>

  constructor(
    private readonly launch: HarnessAgentLauncher,
    private readonly notify: (run: HarnessRunSummary) => void,
    private readonly chatProvider?: (run: HarnessRun) => Promise<TuiAgent | null>,
    private readonly closeSession?: HarnessRunEngineDeps['closeSession']
  ) {
    this.loaded = readPersistedRuns().then((runs) => {
      for (const run of runs) {
        if (!this.runs.has(run.id)) {
          this.runs.set(run.id, run)
        }
      }
    })
  }

  async list(): Promise<HarnessRunSummary[]> {
    await this.loaded
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summarizeHarnessRun)
  }

  async get(runId: string): Promise<HarnessRun | null> {
    await this.loaded
    return this.runs.get(runId) ?? null
  }

  async start(request: HarnessRunStartRequest): Promise<HarnessRun> {
    await this.loaded
    const flow = await getHarnessFlow(request.flowId)
    if (!flow) {
      throw new Error('Flow not found')
    }
    const now = Date.now()
    const run: HarnessRun = {
      id: `run-${randomUUID()}`,
      flowId: flow.id,
      flowName: flow.name,
      flow,
      worktreeId: request.worktreeId,
      mode: request.mode,
      chatSessionId: request.chatSessionId,
      chatTasks: [],
      status: 'running',
      vars: { ...request.fields },
      steps: [],
      pending: [],
      error: null,
      createdAt: now,
      updatedAt: now
    }
    this.runs.set(run.id, run)
    this.prune()
    const engine = new HarnessRunEngine(run, {
      launch: this.launch,
      onChange: (changed) => this.changed(changed),
      chatProvider: this.chatProvider,
      closeSession: this.closeSession
    })
    this.engines.set(run.id, engine)
    engine.start()
    this.changed(run)
    return run
  }

  answer(runId: string, answer: HarnessDecisionAnswer): void {
    this.engines.get(runId)?.answer(answer)
  }

  stop(runId: string): void {
    this.engines.get(runId)?.stop()
  }

  delete(runId: string): void {
    this.engines.get(runId)?.stop()
    this.engines.delete(runId)
    this.runs.delete(runId)
    this.schedulePersist()
  }

  completeChat(runId: string, completion: HarnessChatCompletion): boolean {
    return this.engines.get(runId)?.completeChat(completion) ?? false
  }

  completeSubagent(runId: string, prompt: string, output: string): HarnessSubagentResult {
    return (
      this.engines.get(runId)?.completeSubagent(prompt, output) ?? {
        taskId: null,
        reason: null
      }
    )
  }

  bindChatSession(runId: string, sessionId: string): void {
    const run = this.runs.get(runId)
    if (run && run.mode === 'chat' && !run.chatSessionId) {
      run.chatSessionId = sessionId
      this.changed(run)
    }
  }

  /** The live chat-mode run a caller belongs to: its own session first, then its workspace. */
  async findChatRun(caller: {
    sessionId: string | null
    worktreeId: string | null
  }): Promise<HarnessRun | null> {
    await this.loaded
    const live = [...this.runs.values()]
      .filter((run) => run.mode === 'chat' && this.engines.has(run.id))
      .sort((a, b) => b.createdAt - a.createdAt)
    return (
      (caller.sessionId ? live.find((run) => run.chatSessionId === caller.sessionId) : null) ??
      (caller.worktreeId ? live.find((run) => run.worktreeId === caller.worktreeId) : null) ??
      null
    )
  }

  /** Resolves on the run's next change, or with the same run after `timeoutMs`. */
  waitForChange(runId: string, timeoutMs: number): Promise<HarnessRun | null> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve(this.runs.get(runId) ?? null)
      }
      const listener = (run: HarnessRun): void => {
        if (run.id === runId) {
          done()
        }
      }
      const timer = setTimeout(done, timeoutMs)
      this.listeners.add(listener)
    })
  }

  /** Instructions for a chat starting in `worktreeId`; the first chat to start claims a run that has none. */
  chatInstructions(worktreeId: string, sessionId: string): string | null {
    const run = [...this.runs.values()]
      .filter(
        (entry) =>
          entry.mode === 'chat' && this.engines.has(entry.id) && entry.worktreeId === worktreeId
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!run || (run.chatSessionId && run.chatSessionId !== sessionId)) {
      return null
    }
    this.bindChatSession(run.id, sessionId)
    return harnessChatInstructions(run.flow)
  }

  /** Whether the chat of `worktreeId` may edit files now: only while one of its open tasks allows it. */
  editsAllowed(caller: { sessionId: string | null; worktreeId: string | null }): boolean {
    const live = [...this.runs.values()].filter(
      (run) =>
        run.mode === 'chat' &&
        this.engines.has(run.id) &&
        ((caller.sessionId !== null && run.chatSessionId === caller.sessionId) ||
          (caller.worktreeId !== null && run.worktreeId === caller.worktreeId))
    )
    return live.every((run) => run.chatTasks.some((task) => task.allowEdits))
  }

  private changed(run: HarnessRun): void {
    for (const listener of this.listeners) {
      listener(run)
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') {
      this.engines.delete(run.id)
    }
    this.notify(summarizeHarnessRun(run))
    this.schedulePersist()
  }

  private prune(): void {
    const finished = [...this.runs.values()]
      .filter((run) => !this.engines.has(run.id))
      .sort((a, b) => a.createdAt - b.createdAt)
    while (this.runs.size > MAX_KEPT_RUNS && finished.length > 0) {
      this.runs.delete(finished.shift()!.id)
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      writeSecureJsonFile(runsPath(), { version: 1, runs: [...this.runs.values()] })
    }, PERSIST_DELAY_MS)
  }
}
