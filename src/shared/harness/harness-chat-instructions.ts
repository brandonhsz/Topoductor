import { harnessProjectSection } from './harness-agent-prompt'
import type { HarnessFlow } from './harness-flow-types'

function flowOutline(flow: HarnessFlow): string {
  return flow.nodes
    .filter((node) => node.kind !== 'start')
    .map((node) => {
      const runner = 'runner' in node ? node.runner : null
      const by =
        runner === 'topo'
          ? ' (lo corre Topo con otros agentes)'
          : runner === 'subagent'
            ? ' (lo corren subagentes que lanzas tú)'
            : ''
      return `- ${node.title}${node.block ? ` · ${node.block}` : ''}${by}`
    })
    .join('\n')
}

/** System instructions for the chat that drives a flow: the protocol, the rules and the map, never the step prompts. */
export function harnessChatInstructions(flow: HarnessFlow): string {
  return [
    `# Flujo de trabajo: ${flow.name}`,
    'En este workspace trabajas siguiendo un flujo de Topo Harness. Topo te entrega un paso a la vez y valida cada transición; no puedes saltarte pasos ni adelantarte.',
    '## Protocolo (obligatorio)',
    [
      '1. Antes de cualquier trabajo, corre `topo harness status` (usa `$TOPO_CLI_COMMAND` si `topo` no está en el PATH). Te muestra tu tarea actual con sus instrucciones completas.',
      '2. Haz solo lo que pide esa tarea. Si dice que no edites archivos, no los edites: Topo bloquea las ediciones en esos pasos.',
      '3. Al terminar, escribe tu entregable en un archivo y repórtalo con `topo harness complete --task <id> --output-file <archivo>` (agrega `--outcome` si la tarea lista opciones). La respuesta te da el siguiente paso.',
      '4. Si no tienes tarea (Topo está corriendo pasos con otros agentes, o la persona tiene que decidir), corre `topo harness wait` y sigue con lo que te devuelva.',
      '5. Cuando un paso le toque a la persona, pregúntale aquí en el chat. Registra exactamente lo que diga con `topo harness answer`; nunca decidas por ella.',
      '6. Cuando la persona te escriba algo fuera del flujo, respóndele y vuelve al flujo con `topo harness status`.'
    ].join('\n'),
    flow.sharedInstructions.trim() ? `## Reglas del flujo\n${flow.sharedInstructions.trim()}` : '',
    harnessProjectSection(flow),
    `## Mapa del flujo\nSolo como orientación; el paso actual siempre lo decide Topo.\n${flowOutline(flow)}`
  ]
    .filter(Boolean)
    .join('\n\n')
}
