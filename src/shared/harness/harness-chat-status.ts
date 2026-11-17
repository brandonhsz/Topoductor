import type {
  HarnessChatTask,
  HarnessPendingDecision,
  HarnessRun,
  HarnessRunStatus
} from './harness-run-types'

/** What the workspace chat sees of its run: its open tasks and the decisions waiting on the person. */
export type HarnessChatStatus = {
  runId: string
  flowName: string
  status: HarnessRunStatus
  tasks: HarnessChatTask[]
  /** `fields` lists the start-field keys a restart decision asks for. */
  decisions: (Pick<HarnessPendingDecision, 'id' | 'title' | 'prompt' | 'choices'> & {
    fields: string[]
  })[]
  /** True while Topo runs steps of its own (review table, adversarial review) for this chat. */
  topoWorking: boolean
  error: string | null
}

export function harnessChatStatus(run: HarnessRun): HarnessChatStatus {
  return {
    runId: run.id,
    flowName: run.flowName,
    status: run.status,
    tasks: run.chatTasks,
    decisions: run.pending.map(({ id, title, prompt, choices, fields }) => ({
      id,
      title,
      prompt,
      choices,
      fields: fields.map((field) => field.key)
    })),
    topoWorking: run.steps.some((step) => step.status === 'running' && step.agent !== null),
    error: run.error
  }
}

/** Plain text for the agent: every instruction it needs to take its next step. */
export function formatHarnessChatStatus(status: HarnessChatStatus): string {
  const lines = [`Flujo «${status.flowName}» — ${status.status}`]
  if (status.status === 'completed') {
    lines.push('El flujo terminó. No quedan pasos.')
  }
  if (status.error) {
    lines.push(`Error: ${status.error}`)
  }
  const subagentTasks = status.tasks.filter((task) => task.delivery === 'subagent' && task.subagent)
  if (subagentTasks.length > 0) {
    lines.push(
      '',
      `=== SUBAGENTES (${subagentTasks.length}) ===`,
      'Lanza cada paso como subagente con tu herramienta de subagentes (Agent), todos en paralelo en un mismo mensaje y en primer plano (run_in_background: false).',
      'Usa como description el título y como prompt EXACTAMENTE el texto entre las marcas, sin resumir, agregar ni quitar nada. No escribas tú la respuesta de ningún subagente.',
      'Topo captura cada respuesta por su cuenta: no corras `topo harness complete` para estas tareas. Cuando terminen, corre `topo harness wait`.'
    )
    for (const task of subagentTasks) {
      lines.push(
        '',
        `--- SUBAGENTE ${task.id}: ${task.subagent!.label} ---`,
        '<<<PROMPT',
        task.subagent!.prompt,
        'PROMPT>>>'
      )
    }
  }
  for (const task of status.tasks.filter((entry) => entry.delivery !== 'subagent')) {
    lines.push(
      '',
      `=== TU TAREA ${task.id}: ${task.title} ===`,
      task.allowEdits
        ? 'En este paso puedes editar archivos.'
        : 'En este paso NO edites archivos: Topo bloquea las ediciones.',
      task.instructions,
      '',
      `Cuando termines: topo harness complete --task ${task.id} --output-file <archivo con tu entregable>${task.choices.length > 0 ? ` --outcome "<${task.choices.join(' | ')}>"` : ''}`
    )
  }
  for (const decision of status.decisions) {
    lines.push(
      '',
      `=== DECISIÓN DE LA PERSONA ${decision.id}: ${decision.title} ===`,
      decision.prompt,
      decision.choices.length > 0 ? `Opciones: ${decision.choices.join(' | ')}` : '',
      'Pregúntale a la persona en el chat. Si responde aquí, registra su respuesta con:',
      decision.fields.length > 0
        ? `topo harness answer --decision ${decision.id} ${decision.fields.map((key) => `--field ${key}="<valor>"`).join(' ')}`
        : `topo harness answer --decision ${decision.id}${decision.choices.length > 0 ? ' --choice "<opción>"' : ''} --text "<lo que dijo>"`,
      'Si responde en la tarjeta de Topo, corre `topo harness wait`.'
    )
  }
  if (status.tasks.length === 0 && status.decisions.length === 0 && status.status !== 'completed') {
    lines.push(
      '',
      status.topoWorking
        ? 'Topo está corriendo pasos con otros agentes. Corre `topo harness wait` y sigue cuando te dé una tarea.'
        : 'No hay tareas para ti ahora. Corre `topo harness wait`.'
    )
  }
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
}
