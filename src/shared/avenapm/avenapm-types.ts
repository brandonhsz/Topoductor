export const AVENAPM_DEFAULT_BASE_URL = 'https://avena-pm.vercel.app'

export const AVENAPM_TASK_STATUSES = [
  'por_hacer',
  'en_progreso',
  'en_revision',
  'terminado',
  'archivado'
] as const
export type AvenaPMTaskStatus = (typeof AVENAPM_TASK_STATUSES)[number]

export const AVENAPM_TASK_CLASSIFICATIONS = [
  'incendio',
  'bug',
  'ux',
  'feature',
  'sin_clasificar'
] as const
export type AvenaPMTaskClassification = (typeof AVENAPM_TASK_CLASSIFICATIONS)[number]

/** One card of the AvenaPM operation queue (`GET /api/app/cola`). */
export type AvenaPMTask = {
  id: string
  /** Short ticket id, e.g. `OP-142`. */
  shortId: string | null
  title: string
  description: string | null
  status: string
  priority: number | null
  size: string | null
  classification: string
  assignee: { email: string; name: string } | null
  /** Where the ticket came from (e.g. `intercom`), when AvenaPM knows. */
  source: string | null
  url: string
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export type AvenaPMUser = { email: string; name: string }

export type AvenaPMConnectionStatus =
  | { connected: false; baseUrl: string }
  | { connected: true; baseUrl: string; user: AvenaPMUser }

export type AvenaPMListTasksArgs = {
  status?: AvenaPMTaskStatus | null
  classification?: AvenaPMTaskClassification | null
  includeClosed?: boolean
}

export type AvenaPMListTasksResult =
  | { ok: true; queueName: string; tasks: AvenaPMTask[] }
  | { ok: false; reason: 'not_connected' | 'unauthorized' | 'request_failed'; message: string }
