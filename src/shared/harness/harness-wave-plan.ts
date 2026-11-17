import { asRecord } from '../workspace-setup/setup-script-import-parsers'

export type HarnessWaveTask = {
  id: string
  role: string
  title: string
  criteria: string
  dependsOn: string[]
  files: string[]
  wave: number
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
    wave: Math.max(0, Math.round(wave))
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
    `**${task.id} — ${task.title}** (rol ${task.role}, oleada ${task.wave})`,
    task.criteria ? `Criterios de aceptación: ${task.criteria}` : '',
    task.dependsOn.length ? `Depende de: ${task.dependsOn.join(', ')}` : '',
    task.files.length ? `Archivos: ${task.files.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
