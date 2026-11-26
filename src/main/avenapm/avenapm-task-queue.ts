// Electron-free: the runtime RPC reads the queue through here, and topod has no Electron.
import type {
  AvenaPMListTasksArgs,
  AvenaPMListTasksResult,
  AvenaPMTask
} from '../../shared/avenapm/avenapm-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { readAvenaPMCredential } from './avenapm-credential-store'
import { readUser, requestJson } from './avenapm-http'

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapTask(value: unknown, baseUrl: string): AvenaPMTask | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') {
    return null
  }
  const priority = typeof raw.priority === 'number' ? raw.priority : Number(raw.priority)
  return {
    id: raw.id,
    shortId: stringOrNull(raw.idCorto),
    title: raw.title,
    description: stringOrNull(raw.description),
    status: stringOrNull(raw.status) ?? 'por_hacer',
    priority: Number.isFinite(priority) ? priority : null,
    size: stringOrNull(raw.size),
    classification: stringOrNull(raw.clasificacion) ?? 'sin_clasificar',
    assignee: readUser(raw.assignee),
    source: stringOrNull(raw.source),
    url: `${baseUrl}/tareas?tarea=${encodeURIComponent(raw.id)}`,
    createdAt: stringOrNull(raw.createdAt) ?? '',
    updatedAt: stringOrNull(raw.updatedAt) ?? '',
    doneAt: stringOrNull(raw.doneAt)
  }
}

export async function listAvenaPMTasks(
  args: AvenaPMListTasksArgs = {}
): Promise<AvenaPMListTasksResult> {
  const credential = readAvenaPMCredential()
  if (!credential) {
    return { ok: false, reason: 'not_connected', message: 'AvenaPM is not connected.' }
  }
  const url = new URL(`${credential.baseUrl}/api/app/cola`)
  if (args.status) {
    url.searchParams.set('status', args.status)
  }
  if (args.classification) {
    url.searchParams.set('clasificacion', args.classification)
  }
  if (args.includeClosed) {
    url.searchParams.set('incluirCerradas', '1')
  }
  try {
    const { status, body } = await requestJson(url.toString(), { token: credential.token })
    if (status === 401) {
      return {
        ok: false,
        reason: 'unauthorized',
        message: 'AvenaPM session expired. Sign in again.'
      }
    }
    if (status !== 200) {
      const error = asRecord(body)?.error
      return {
        ok: false,
        reason: 'request_failed',
        message: typeof error === 'string' ? error : `AvenaPM request failed (${status}).`
      }
    }
    const payload = asRecord(body)
    const rawTasks: unknown[] = Array.isArray(payload?.tareas) ? payload.tareas : []
    const queueName = asRecord(payload?.cola)?.name
    return {
      ok: true,
      queueName: typeof queueName === 'string' ? queueName : 'Operación',
      tasks: rawTasks
        .map((task) => mapTask(task, credential.baseUrl))
        .filter((task): task is AvenaPMTask => task !== null)
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'request_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
