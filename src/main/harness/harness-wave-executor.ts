import {
  contextEntries,
  extractSection,
  extractSummary
} from '../../shared/harness/harness-agent-prompt'
import type { HarnessWavesNode } from '../../shared/harness/harness-flow-types'
import {
  formatWaveTask,
  parseHarnessWavePlan,
  type HarnessWaveTask
} from '../../shared/harness/harness-wave-plan'
import { CONTINUE, RETRY, STOP, type HarnessStepRuntime } from './harness-step-runtime'

const WAVE_FIX_ATTEMPTS = 2

const SUMMARY_RULE =
  'Al final escribe una sección `## Resumen` de máximo 5 líneas: qué cambiaste, en qué archivos y qué quedó pendiente.'

async function runWaveTask(
  rt: HarnessStepRuntime,
  node: HarnessWavesNode,
  task: HarnessWaveTask,
  context: { key: string; value: string }[],
  feedback: string
): Promise<string> {
  const role =
    node.roles.find((candidate) => candidate.name.toLowerCase() === task.role.toLowerCase()) ?? null
  const result = await rt.runAgentStep({
    nodeId: node.id,
    taskId: task.id,
    title: `${task.id} · ${task.title}`,
    block: node.block,
    agent: role?.agent ?? null,
    instructions: [
      role?.prompt ?? `Eres el agente del rol ${task.role}.`,
      role?.paths.length
        ? `Tu capa (solo tocas esto, salvo que la tarea diga otra cosa): ${role.paths.join(', ')}`
        : '',
      `## Tarea asignada\n${formatWaveTask(task)}`,
      'Trabajas en paralelo con otros agentes en el mismo workspace: toca solo los archivos de tu tarea y no hagas commits.',
      SUMMARY_RULE
    ]
      .filter(Boolean)
      .join('\n\n'),
    context: feedback ? [...context, { key: 'verificacion_fallida', value: feedback }] : context,
    choices: [],
    // A retry after a failed verification continues the chat that wrote the task.
    sessionKey: `${node.id}:${task.id}`
  })
  return result ? extractSummary(result.output) : '(tarea omitida)'
}

function closingInstructions(
  rt: HarnessStepRuntime,
  node: HarnessWavesNode,
  wave: number,
  verify: string
): string {
  const { flowName, flow } = rt.run
  const stacked = flow.project.prMode === 'stacked'
  return [
    'Cierras una oleada que escribieron otros agentes. No confíes en sus resúmenes: revisa el estado real del workspace.',
    verify
      ? `1. Corre \`${verify}\` y reporta el resultado real. Si algo falla, indica qué tareas (por ID) son dueñas del problema y por qué.`
      : '1. No hay comando de verificación: omite este paso.',
    '2. Escribe una sección `## Diff real` a partir de `git status --porcelain` y `git diff HEAD` (incluye archivos nuevos): una línea por archivo con su ruta y qué cambió de verdad. Marca con ⚠️ las tareas cuyo resumen no coincide con el diff. Si el workspace no es un repositorio git, descríbelo a partir de los archivos y dilo. Máximo 40 líneas.',
    node.checkpointEachWave
      ? `3. ${verify ? 'Solo si la verificación pasa: ' : ''}si es un repositorio git y hay cambios, haz \`git add -A\` y un commit "Harness ${flowName}: oleada ${wave}".`
      : '3. No hagas commits.',
    stacked && node.checkpointEachWave
      ? `4. PRs apilados: después del commit, crea una rama nueva para esta oleada a partir de la actual (sufijo "-oleada-${wave}"), súbela y abre un pull request (o merge request, según el proveedor: gh, glab…) cuya base sea la rama de la oleada anterior, o la rama base del trabajo si es la primera. El PR debe poder revisarse solo. Da su enlace. Si no hay remoto o permisos, dilo con la salida real.`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Verifies, audits the real diff and checkpoints the wave; returns null only when the person skipped it. */
async function closeWave(
  rt: HarnessStepRuntime,
  node: HarnessWavesNode,
  wave: number,
  tasks: HarnessWaveTask[],
  summaries: string[]
): Promise<Awaited<ReturnType<HarnessStepRuntime['runAgentStep']>>> {
  const verify = node.verifyCommand.trim() || rt.run.flow.project.testCommand.trim()
  return rt.runAgentStep({
    nodeId: node.id,
    taskId: `oleada-${wave}`,
    title: `Cierre oleada ${wave}`,
    block: node.block,
    agent: node.roles.find((role) => role.name === 'Pruebas')?.agent ?? null,
    instructions: closingInstructions(rt, node, wave, verify),
    context: [
      { key: 'tareas', value: tasks.map(formatWaveTask).join('\n\n') },
      { key: 'resumenes_de_los_agentes', value: summaries.join('\n\n') }
    ],
    choices: verify ? ['ok', 'falla'] : [],
    sessionKey: null
  })
}

/** Waves run in order; the tasks of one wave run in parallel in the same workspace. */
export async function executeWavesNode(
  rt: HarnessStepRuntime,
  node: HarnessWavesNode
): Promise<string | null> {
  const plan = parseHarnessWavePlan(rt.run.vars[node.planKey] ?? '')
  if (!plan) {
    throw new Error(
      `«${node.title}» no encontró un plan con bloque \`\`\`json en la variable «${node.planKey}».`
    )
  }
  const context = contextEntries(rt.run.vars, node.inputs)
  const report: string[] = []
  for (const { wave, tasks } of plan.waves) {
    let pendingTasks = tasks
    let feedback = ''
    const summaries = new Map<string, string>()
    let diff = ''
    for (let attempt = 1; ; attempt++) {
      const results = await Promise.all(
        pendingTasks.map((task) => runWaveTask(rt, node, task, context, feedback))
      )
      results.forEach((summary, index) => {
        const task = pendingTasks[index]!
        summaries.set(task.id, `${formatWaveTask(task)}\n${summary}`)
      })
      const closing = await closeWave(rt, node, wave, tasks, [...summaries.values()])
      diff = closing ? (extractSection(closing.output, 'Diff real') ?? closing.output) : diff
      if (!closing || closing.outcome !== 'falla') {
        break
      }
      if (attempt >= WAVE_FIX_ATTEMPTS) {
        const answer = await rt.ask(closing.step, {
          title: `Oleada ${wave}`,
          reason: 'wave-failed',
          prompt: `La verificación de la oleada ${wave} sigue fallando después de ${WAVE_FIX_ATTEMPTS} intentos.`,
          context: [{ key: 'verificacion', value: closing.output }],
          choices: [RETRY, CONTINUE, STOP],
          fields: []
        })
        if (answer.choice === STOP) {
          rt.stopRun()
        }
        if (answer.choice === CONTINUE) {
          break
        }
      }
      const owners = tasks.filter((task) => closing.output.includes(task.id))
      pendingTasks = owners.length > 0 ? owners : tasks
      feedback = closing.output
    }
    report.push(
      [
        `## Oleada ${wave}`,
        `### Diff real (auditado)\n${diff || '(sin cierre)'}`,
        `### Lo que reportaron los agentes\n${[...summaries.values()].join('\n\n')}`
      ].join('\n\n')
    )
  }
  rt.run.vars[node.outputKey] = report.join('\n\n---\n\n')
  return null
}
