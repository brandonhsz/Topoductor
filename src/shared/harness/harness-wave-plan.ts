import { asRecord } from '../workspace-setup/setup-script-import-parsers'

export type HarnessWaveTask = {
  id: string
  role: string
  title: string
  criteria: string
  dependsOn: string[]
  files: string[]
  wave: number
  /** TDD red phase: its tests are meant to fail until a later wave implements them. */
  red: boolean
}

export type HarnessWavePlan = { waves: { wave: number; tasks: HarnessWaveTask[] }[] }

const JSON_FENCE = /```json\s*([\s\S]*?)```/gi

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function task(raw: unknown, index: number): HarnessWaveTask | null {
  const record = asRecord(raw)
  const title = typeof record?.title === 'string' ? record.title.trim() : ''
  const role = typeof record?.role === 'string' ? record.role.trim() : ''
  if (!record || !title || !role) {
    return null
  }
  const wave = typeof record.wave === 'number' && Number.isFinite(record.wave) ? record.wave : 0
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `T${index}`,
    role,
    title,
    criteria: typeof record.criteria === 'string' ? record.criteria : '',
    dependsOn: strings(record.dependsOn),
    files: strings(record.files),
    wave: Math.max(0, Math.round(wave)),
    red: record.red === true
  }
}

/** Reads the last ```json block holding `{ "tasks": [...] }`; null when there is none. */
export function parseHarnessWavePlan(text: string): HarnessWavePlan | null {
  const blocks = [...text.matchAll(JSON_FENCE)].map((match) => match[1]!).toReversed()
  for (const block of blocks) {
    try {
      const tasks = asRecord(JSON.parse(block))?.tasks
      if (!Array.isArray(tasks)) {
        continue
      }
      const parsed = tasks.map(task).filter((entry): entry is HarnessWaveTask => entry !== null)
      if (parsed.length === 0) {
        continue
      }
      const byWave = new Map<number, HarnessWaveTask[]>()
      for (const entry of parsed) {
        byWave.set(entry.wave, [...(byWave.get(entry.wave) ?? []), entry])
      }
      return {
        waves: [...byWave.entries()]
          .sort(([a], [b]) => a - b)
          .map(([wave, waveTasks]) => ({ wave, tasks: waveTasks }))
      }
    } catch {
      continue
    }
  }
  return null
}

export function formatWaveTask(task: HarnessWaveTask): string {
  return [
    `**${task.id} — ${task.title}** (rol ${task.role}, oleada ${task.wave}${task.red ? ', fase roja' : ''})`,
    task.criteria ? `Criterios de aceptación: ${task.criteria}` : '',
    task.dependsOn.length ? `Depende de: ${task.dependsOn.join(', ')}` : '',
    task.files.length ? `Archivos: ${task.files.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The red phase of a wave holds only tests meant to fail; an empty wave is never red. */
export function isRedWave(tasks: readonly HarnessWaveTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.red)
}

/** Plan rules the prompt asks for but an agent may break: shared files in one wave and unordered dependencies. */
export function harnessWavePlanProblems(plan: HarnessWavePlan): string[] {
  const waveOf = new Map(
    plan.waves.flatMap(({ tasks }) => tasks.map((task) => [task.id, task.wave]))
  )
  const problems: string[] = []
  for (const { wave, tasks } of plan.waves) {
    const owners = new Map<string, string[]>()
    for (const task of tasks) {
      for (const file of new Set(task.files)) {
        owners.set(file, [...(owners.get(file) ?? []), task.id])
      }
      for (const dependency of task.dependsOn) {
        const dependencyWave = waveOf.get(dependency)
        if (dependencyWave === undefined) {
          problems.push(`${task.id} depende de ${dependency}, que no está en el plan.`)
        } else if (dependencyWave >= wave) {
          problems.push(
            `${task.id} (oleada ${wave}) depende de ${dependency} (oleada ${dependencyWave}), que no termina antes.`
          )
        }
      }
    }
    for (const [file, ids] of owners) {
      if (ids.length > 1) {
        problems.push(`${ids.join(' y ')} tocan ${file} en la misma oleada ${wave}.`)
      }
    }
  }
  return problems
}
