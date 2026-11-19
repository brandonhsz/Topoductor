import type { HarnessFlow } from './harness-flow-types'

/** Problems that would stall a run, in the order a person should fix them. */
export function harnessFlowProblems(flow: HarnessFlow): string[] {
  const problems: string[] = []
  const starts = flow.nodes.filter((node) => node.kind === 'start')
  if (starts.length !== 1) {
    problems.push('El flujo necesita exactamente un nodo de inicio.')
  }
  const links = [
    ...flow.edges,
    ...flow.nodes.flatMap((node) =>
      'limitTarget' in node && node.limitTarget
        ? [{ source: node.id, target: node.limitTarget }]
        : []
    )
  ]
  const reachable = new Set<string>(starts.map((node) => node.id))
  const queue = [...reachable]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const link of links) {
      if (link.source === current && !reachable.has(link.target)) {
        reachable.add(link.target)
        queue.push(link.target)
      }
    }
  }
  const unreachable = flow.nodes.filter((node) => !reachable.has(node.id))
  if (unreachable.length > 0) {
    problems.push(
      `Nodos sin camino desde el inicio: ${unreachable.map((node) => node.title).join(', ')}.`
    )
  }
  for (const node of flow.nodes) {
    if (node.kind === 'agent' && !node.prompt.trim()) {
      problems.push(`«${node.title}» no tiene prompt.`)
    }
    if (node.kind === 'waves' && node.roles.length === 0) {
      problems.push(`«${node.title}» no tiene roles.`)
    }
  }
  return problems
}
