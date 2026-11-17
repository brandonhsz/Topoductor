import { tuiAgentDisplayName } from '../agent-launch/catalog/tui-agent-display-names'
import { describeCondition, harnessProjectSection } from './harness-agent-prompt'
import type { HarnessFlow, HarnessNode } from './harness-flow-types'

function mermaidLabel(value: string): string {
  return value.replace(/"/g, "'").replace(/[[\]{}()<>|]/g, ' ')
}

function mermaidNode(node: HarnessNode): string {
  const label = `"${mermaidLabel(node.title)}"`
  switch (node.kind) {
    case 'start':
    case 'end':
      return `${node.id}([${label}])`
    case 'human':
      return `${node.id}{{${label}}}`
    case 'waves':
      return `${node.id}[[${label}]]`
    case 'agent':
      return `${node.id}[${label}]`
  }
}

function nodeSection(flow: HarnessFlow, node: HarnessNode): string {
  const lines = [`### ${node.title}${node.block ? ` · ${node.block}` : ''}`]
  const next = flow.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => {
      const target = flow.nodes.find((candidate) => candidate.id === edge.target)?.title
      const when = edge.when ? ` (si ${describeCondition(edge.when)})` : ''
      return edge.label ? `${edge.label}${when} → ${target}` : `→ ${target}${when}`
    })
  switch (node.kind) {
    case 'start':
      lines.push(
        'Punto de partida. Registra:',
        ...node.fields.map(
          (field) =>
            `- **${field.label}**${field.options.length ? ` (${field.options.join(' / ')})` : ''}`
        )
      )
      break
    case 'agent':
      lines.push(
        `Agente: ${node.agent ? tuiAgentDisplayName(node.agent) : `el del flujo (${tuiAgentDisplayName(flow.defaultAgent)})`}. Recibe: ${node.inputs.join(', ') || '—'}. Entrega: \`${node.outputKey}\`.${node.joinAll ? ' Espera a todos los nodos anteriores.' : ''}`,
        '',
        node.prompt
      )
      break
    case 'human':
      lines.push(`Turno del usuario. Muestra: ${node.inputs.join(', ') || '—'}.`, '', node.prompt)
      break
    case 'waves':
      lines.push(
        `Ejecuta el plan de \`${node.planKey}\` por oleadas: las tareas de una oleada corren en paralelo y la siguiente oleada empieza cuando terminan todas.${node.verifyCommand ? ` Tras cada oleada se verifica con \`${node.verifyCommand}\`.` : ''}${node.checkpointEachWave ? ' Cada oleada termina con un commit de checkpoint.' : ''}`,
        '',
        ...node.roles.map((role) => `**Rol ${role.name}:** ${role.prompt}`)
      )
      break
    case 'end':
      lines.push('Fin del recorrido.')
      break
  }
  if ('limitTarget' in node && node.limitTarget) {
    const target = flow.nodes.find((candidate) => candidate.id === node.limitTarget)?.title
    next.push(`al llegar a ${node.maxVisits} visitas → ${target}`)
  }
  if (next.length > 0) {
    lines.push('', `**Siguiente:** ${next.join(' · ')}`)
  }
  return lines.join('\n')
}

/** The flow as instructions any agent can follow without Topo driving it. */
export function harnessFlowToMarkdown(flow: HarnessFlow): string {
  const diagram = [
    'flowchart TD',
    ...flow.nodes.map((node) => `    ${mermaidNode(node)}`),
    ...flow.edges.map((edge) => {
      const label = [edge.label, edge.when ? describeCondition(edge.when) : '']
        .filter(Boolean)
        .join(' · ')
      return label
        ? `    ${edge.source} -->|${mermaidLabel(label)}| ${edge.target}`
        : `    ${edge.source} --> ${edge.target}`
    }),
    ...flow.nodes.flatMap((node) =>
      'limitTarget' in node && node.limitTarget
        ? [`    ${node.id} -.->|límite| ${node.limitTarget}`]
        : []
    )
  ].join('\n')
  return [
    `# ${flow.name}`,
    flow.description,
    'Todo trabajo sigue este grafo. Ningún nodo se salta.',
    `\`\`\`mermaid\n${diagram}\n\`\`\``,
    flow.sharedInstructions ? `## Reglas para todos los agentes\n${flow.sharedInstructions}` : '',
    harnessProjectSection(flow),
    '## Nodos',
    ...flow.nodes.map((node) => nodeSection(flow, node))
  ]
    .filter(Boolean)
    .join('\n\n')
}
