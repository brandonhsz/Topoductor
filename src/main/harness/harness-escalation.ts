import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import type { HarnessRoute } from './harness-node-executors'
import type { HarnessDecisionAnswer, HarnessRunStep } from '../../shared/harness/harness-run-types'
import {
  HarnessRedirect,
  type HarnessDecisionRequest,
  type HarnessStepRuntime
} from './harness-step-runtime'

const ESCALATED = 'Escalado'

/** Unattended flows hand any wait on a person to their escalation node, except human nodes and the node itself. */
export function harnessEscalationTarget(flow: HarnessFlow, nodeId: string): string | null {
  const target = flow.escalationNode
  if (!target || nodeId === target || !flow.nodes.some((node) => node.id === target)) {
    return null
  }
  return flow.nodes.find((node) => node.id === nodeId)?.kind === 'human' ? null : target
}

/** What the escalation node receives as `motivo_escalado`: the question nobody was there to answer. */
function describeEscalation(step: HarnessRunStep, decision: HarnessDecisionRequest): string {
  return [
    `**Paso:** ${step.title} (ronda ${step.visit})`,
    `**Motivo:** ${decision.prompt}`,
    decision.choices.length > 0 ? `**Opciones que había:** ${decision.choices.join(', ')}` : '',
    ...decision.context.map((entry) => `### ${entry.key}\n${entry.value}`)
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Rejects so the asking executor unwinds and the engine continues at `target`. */
export function escalateDecision(
  rt: Pick<HarnessStepRuntime, 'writeVar' | 'finishStep'>,
  step: HarnessRunStep,
  decision: HarnessDecisionRequest,
  target: string
): Promise<HarnessDecisionAnswer> {
  rt.writeVar('motivo_escalado', describeEscalation(step, decision))
  if (step.status === 'waiting') {
    rt.finishStep(step, { status: 'done', outcome: ESCALATED })
  }
  return Promise.reject(new HarnessRedirect(target))
}

/** Turns a redirect thrown anywhere inside a node into the route the engine follows. */
export function followRedirect(error: unknown): HarnessRoute {
  if (error instanceof HarnessRedirect) {
    return { goto: error.nodeId }
  }
  throw error
}
