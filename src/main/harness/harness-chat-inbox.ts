import type {
  HarnessChatCompletion,
  HarnessChatTask,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'
import type { HarnessChatTaskRequest } from './harness-step-runtime'

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
    const task: HarnessChatTask = {
      ...request,
      id: `${this.run.id}-c${++this.counter}`,
      stepId: step.id,
      createdAt: Date.now()
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(task.id, { resolve, reject })
      this.run.chatTasks.push(task)
      this.touch()
    })
  }

  /** False when the task is unknown or already reported. */
  complete(completion: HarnessChatCompletion): boolean {
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
