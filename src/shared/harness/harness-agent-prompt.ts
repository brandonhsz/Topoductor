import type { HarnessEdge, HarnessEdgeCondition, HarnessFlow } from './harness-flow-types'

const OUTCOME_LINE = /^\s*\**\s*SALIDA\s*\**\s*:\s*(.+?)\s*$/im
/** Keeps prompts bounded when an upstream step wrote a lot; the full text stays in the run. */
const MAX_CONTEXT_CHARS = 24_000
const SUMMARY_FALLBACK_CHARS = 1_500

function comparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ`"'*_.]/g, '')
    .trim()
    .toLowerCase()
}

export function conditionHolds(
  when: HarnessEdgeCondition | null,
  vars: Record<string, string>
): boolean {
  if (!when) {
    return true
  }
  const equal = comparable(vars[when.key] ?? '') === comparable(when.value)
  return when.op === 'eq' ? equal : !equal
}

export function describeCondition(when: HarnessEdgeCondition): string {
  return `${when.key} ${when.op === 'eq' ? '=' : '≠'} ${when.value || '∅'}`
}

/** Unlabeled edges always fire; labeled ones only for the chosen outcome. Both need their condition. */
export function edgeFires(
  edge: HarnessEdge,
  outcome: string | null,
  vars: Record<string, string>
): boolean {
  return (!edge.label || edge.label === outcome) && conditionHolds(edge.when, vars)
}

/** Labels of the outgoing edges whose condition holds now. */
export function outcomeChoices(
  flow: HarnessFlow,
  nodeId: string,
  vars: Record<string, string>
): string[] {
  return [
    ...new Set(
      flow.edges
        .filter((edge) => edge.source === nodeId && edge.label && conditionHolds(edge.when, vars))
        .map((edge) => edge.label)
    )
  ]
}

/** The last `SALIDA: <label>` line that names one of `choices`; null when the agent picked none. */
export function parseOutcome(output: string, choices: readonly string[]): string | null {
  const lines = output.split('\n').toReversed()
  for (const line of lines) {
    const match = OUTCOME_LINE.exec(line)
    if (!match) {
      continue
    }
    return matchOutcome(match[1]!, choices)
  }
  return null
}

/** The choice `label` names, ignoring case, accents and quotes; null when it names none. */
export function matchOutcome(label: string, choices: readonly string[]): string | null {
  const picked = comparable(label)
  return choices.find((choice) => comparable(choice) === picked) ?? null
}

/** Text under the last `## <title>` heading (any level), up to the next heading of that level or higher. */
export function extractSection(output: string, title: string): string | null {
  const heading = new RegExp(`^(#{1,4})\\s*${title}\\s*$`, 'gim')
  const last = [...output.matchAll(heading)].at(-1)
  if (last?.index === undefined) {
    return null
  }
  const rest = output.slice(last.index + last[0].length)
  const next = new RegExp(`^#{1,${last[1]!.length}}\\s`, 'm').exec(rest)
  return (next ? rest.slice(0, next.index) : rest).replace(OUTCOME_LINE, '').trim()
}

/** The `## Resumen` section, or the tail of the reply when the agent wrote none. */
export function extractSummary(output: string): string {
  const section = extractSection(output, 'Resumen')
  if (section) {
    return section
  }
  return output.length > SUMMARY_FALLBACK_CHARS
    ? `…${output.slice(-SUMMARY_FALLBACK_CHARS)}`
    : output
}

/** Repo facts every agent needs; empty when the flow has none, so generic flows stay quiet. */
export function harnessProjectSection(flow: HarnessFlow): string {
  const { project } = flow
  const roles = flow.nodes.flatMap((node) =>
    node.kind === 'waves'
      ? node.roles.map(
          (role) =>
            `- ${role.name}: ${role.paths.length > 0 ? role.paths.join(', ') : 'capa a definir en el plan'}`
        )
      : []
  )
  const lines = [
    project.appCommand && `- Levantar la app: \`${project.appCommand}\``,
    project.appUrl && `- URL de la app: ${project.appUrl}`,
    project.testCommand && `- Pruebas y checks: \`${project.testCommand}\``,
    project.evidenceTool && `- Evidencias: ${project.evidenceTool}`,
    `- PRs: ${project.prMode === 'stacked' ? 'apilados, uno por oleada' : 'uno solo al final'}`,
    roles.length > 0 && `- Roles de implementación y su capa:\n${roles.join('\n')}`,
    project.notes.trim() && `- Reglas del repositorio:\n${project.notes.trim()}`
  ].filter(Boolean)
  return lines.length > 1 || project.prMode === 'stacked' ? `## Proyecto\n${lines.join('\n')}` : ''
}

export type HarnessContextEntry = { key: string; value: string }

export function contextEntries(
  vars: Record<string, string>,
  keys: readonly string[]
): HarnessContextEntry[] {
  return keys.flatMap((key) => {
    const value = vars[key]?.trim()
    if (!value) {
      return []
    }
    return [
      {
        key,
        value:
          value.length > MAX_CONTEXT_CHARS
            ? `(recortado: el texto completo está en la ejecución en Topo)\n…${value.slice(-MAX_CONTEXT_CHARS)}`
            : value
      }
    ]
  })
}

export function buildHarnessAgentPrompt(input: {
  flow: HarnessFlow
  title: string
  block: string
  visit: number
  instructions: string
  context: readonly HarnessContextEntry[]
  choices: readonly string[]
  /** The agent already has the rules and its task from an earlier visit in this chat. */
  continuing?: boolean
}): string {
  const heading = input.block ? `${input.title} (${input.block})` : input.title
  const sections = input.continuing
    ? [
        `# Nueva ronda (${input.visit}) del nodo «${heading}»`,
        'Sigue con la misma tarea de antes y las mismas reglas, usando el contexto actualizado de abajo.'
      ]
    : [
        `# Harness «${input.flow.name}» — nodo «${heading}», ronda ${input.visit}`,
        input.flow.sharedInstructions.trim(),
        harnessProjectSection(input.flow),
        `## Tu tarea\n${input.instructions.trim()}`
      ]
  if (input.context.length > 0) {
    sections.push(
      `## Contexto\n${input.context.map((entry) => `### ${entry.key}\n${entry.value}`).join('\n\n')}`
    )
  }
  const finish = [
    '## Cómo terminar',
    'Tu respuesta final es el entregable de este nodo: Topo la pasa tal cual al siguiente nodo.'
  ]
  if (input.choices.length > 0) {
    finish.push(
      `Termina con una línea exacta \`SALIDA: <opción>\` usando una de: ${input.choices.map((choice) => `"${choice}"`).join(', ')}.`
    )
  }
  sections.push(finish.join('\n'))
  return sections.filter(Boolean).join('\n\n')
}
