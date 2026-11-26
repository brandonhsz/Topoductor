import { contextEntries, type HarnessContextEntry } from '../../shared/harness/harness-agent-prompt'
import type { HarnessNode } from '../../shared/harness/harness-flow-types'

type StepNode = Extract<HarnessNode, { inputs: string[] }>

/** Write order of run variables, so `freshInputs` skip values a node already received. */
export class HarnessInputFreshness {
  private readonly writtenAt = new Map<string, number>()
  private readonly takenAt = new Map<string, number>()
  private counter = 0

  write(vars: Record<string, string>, key: string, value: string): void {
    vars[key] = value
    this.writtenAt.set(key, ++this.counter)
  }

  context(vars: Record<string, string>, node: StepNode): HarnessContextEntry[] {
    const takenAt = this.takenAt.get(node.id)
    const fresh = new Set(node.freshInputs ?? [])
    const keys = node.inputs.filter(
      (key) => takenAt === undefined || !fresh.has(key) || (this.writtenAt.get(key) ?? 0) > takenAt
    )
    this.takenAt.set(node.id, this.counter)
    return contextEntries(vars, keys)
  }
}
