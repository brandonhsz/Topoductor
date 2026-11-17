import type {
  HarnessChatCompletion,
  HarnessChatTask,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'
import {
  harnessSubagentPrompt,
  matchSubagentPrompt,
  type HarnessSubagentResult
} from '../../shared/harness/harness-subagent-contract'
import type { HarnessChatTaskRequest } from './harness-step-runtime'

const SUBAGENT_REJECTIONS = {
  no_marker: null,
  unknown_task:
    'Topo Harness: ese subagente no corresponde a ningún paso abierto. Corre `topo harness status`.',
  prompt_mismatch:
    'Topo Harness: el prompt del subagente no es el exacto del paso. Lánzalo otra vez con el prompt tal cual, sin agregar ni resumir nada.'
} as const

/** Steps waiting on the workspace chat; each resolves when the chat reports it through `topo harness`. */
export class HarnessChatInbox {
  private readonly waiters = new Map<
    string,
    { resolve: (completion: HarnessChatCompletion) => void; reject: (error: Error) => void }
  >()
  private counter = 0

  constructor(
    private readonly run: HarnessRun,
    private readonly touch: () => void
  ) {}

  open(step: HarnessRunStep, request: HarnessChatTaskRequest): Promise<HarnessChatCompletion> {
    const { delivery = 'self', ...fields } = request
    const id = `${this.run.id}-c${++this.counter}`
    const task: HarnessChatTask = {
      ...fields,
      id,
      stepId: step.id,
      delivery,
      subagent:
        delivery === 'subagent'
          ? { label: request.title, prompt: harnessSubagentPrompt(id, request.instructions) }
          : null,
      createdAt: Date.now()
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(task.id, { resolve, reject })
      this.run.chatTasks.push(task)
      this.touch()
    })
  }

  /** False when the task is unknown, already reported, or must come from a subagent. */
  complete(completion: HarnessChatCompletion): boolean {
    const task = this.run.chatTasks.find((entry) => entry.id === completion.taskId)
    if (task?.delivery === 'subagent') {
      return false
    }
    return this.settle(completion)
  }

  /** Completes the subagent task whose exact prompt was captured; a reason when the prompt does not fit. */
  completeSubagent(prompt: string, output: string): HarnessSubagentResult {
    const match = matchSubagentPrompt(prompt, this.run.chatTasks)
    if ('error' in match) {
      return { taskId: null, reason: SUBAGENT_REJECTIONS[match.error] }
    }
    this.settle({ taskId: match.task.id, output, outcome: null })
    return { taskId: match.task.id, reason: null }
  }

  private settle(completion: HarnessChatCompletion): boolean {
    const waiter = this.waiters.get(completion.taskId)
    if (!waiter) {
      return false
    }
    this.waiters.delete(completion.taskId)
    this.run.chatTasks = this.run.chatTasks.filter((task) => task.id !== completion.taskId)
    this.touch()
    waiter.resolve(completion)
    return true
  }

  cancelAll(error: Error): void {
    for (const waiter of this.waiters.values()) {
      waiter.reject(error)
    }
    this.waiters.clear()
    this.run.chatTasks = []
  }
}
