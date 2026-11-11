import type { AvenaPMTask } from '../../../../../shared/avenapm/avenapm-types'
import { asRecord } from '../../../../../shared/workspace-setup/setup-script-import-parsers'

export type AvenaPMWorkState = 'open' | 'unstarted' | 'active' | 'in_review' | 'done' | 'all'
export type AvenaPMAssigneeFilter =
  | { kind: 'all' }
  | { kind: 'me' }
  | { kind: 'unassigned' }
  | { kind: 'person'; email: string }
export type AvenaPMSort =
  | 'triage'
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'priority_desc'
  | 'status'
  | 'assignee'
export type AvenaPMGroupBy = 'none' | 'status' | 'assignee' | 'classification'

export type AvenaPMTaskView = {
  workState: AvenaPMWorkState
  assignee: AvenaPMAssigneeFilter
  /** Empty selects every classification. */
  classifications: string[]
  sort: AvenaPMSort
  groupBy: AvenaPMGroupBy
  search: string
}

export const DEFAULT_AVENAPM_TASK_VIEW: AvenaPMTaskView = {
  workState: 'open',
  assignee: { kind: 'all' },
  classifications: [],
  sort: 'triage',
  groupBy: 'none',
  search: ''
}

export const AVENAPM_STATUS_ORDER = [
  'por_hacer',
  'en_progreso',
  'en_revision',
  'terminado',
  'archivado'
] as const
export const AVENAPM_CLASSIFICATION_ORDER = [
  'incendio',
  'bug',
  'ux',
  'feature',
  'sin_clasificar'
] as const

const WORK_STATE_STATUSES: Record<AvenaPMWorkState, readonly string[] | null> = {
  open: ['por_hacer', 'en_progreso', 'en_revision'],
  unstarted: ['por_hacer'],
  active: ['en_progreso'],
  in_review: ['en_revision'],
  done: ['terminado'],
  all: null
}

/** Closed tickets are only fetched when the selected work state can show them. */
export function workStateNeedsClosedTasks(workState: AvenaPMWorkState): boolean {
  return workState === 'done' || workState === 'all'
}

function rankIn(order: readonly string[], value: string): number {
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

function matchesAssignee(
  task: AvenaPMTask,
  filter: AvenaPMAssigneeFilter,
  myEmail: string | null
): boolean {
  const email = task.assignee?.email.toLowerCase() ?? null
  switch (filter.kind) {
    case 'all':
      return true
    case 'me':
      return email !== null && email === myEmail?.toLowerCase()
    case 'unassigned':
      return email === null
    case 'person':
      return email === filter.email.toLowerCase()
  }
}

function matchesSearch(task: AvenaPMTask, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) {
    return true
  }
  return (
    task.title.toLowerCase().includes(needle) ||
    (task.shortId?.toLowerCase().includes(needle) ?? false) ||
    (task.assignee?.name.toLowerCase().includes(needle) ?? false)
  )
}

export function filterAvenaPMTasks(
  tasks: readonly AvenaPMTask[],
  view: AvenaPMTaskView,
  myEmail: string | null
): AvenaPMTask[] {
  const statuses = WORK_STATE_STATUSES[view.workState]
  return tasks.filter(
    (task) =>
      (statuses === null || statuses.includes(task.status)) &&
      matchesAssignee(task, view.assignee, myEmail) &&
      (view.classifications.length === 0 || view.classifications.includes(task.classification)) &&
      matchesSearch(task, view.search)
  )
}

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** `triage` keeps AvenaPM's own queue order (classification, priority, then age). */
export function sortAvenaPMTasks(tasks: readonly AvenaPMTask[], sort: AvenaPMSort): AvenaPMTask[] {
  const sorted = [...tasks]
  switch (sort) {
    case 'triage':
      return sorted
    case 'created_desc':
      return sorted.sort((a, b) => time(b.createdAt) - time(a.createdAt))
    case 'created_asc':
      return sorted.sort((a, b) => time(a.createdAt) - time(b.createdAt))
    case 'updated_desc':
      return sorted.sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
    case 'priority_desc':
      return sorted.sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1))
    case 'status':
      return sorted.sort(
        (a, b) => rankIn(AVENAPM_STATUS_ORDER, a.status) - rankIn(AVENAPM_STATUS_ORDER, b.status)
      )
    case 'assignee':
      // Unassigned last: those are the tickets nobody has picked up yet.
      return sorted.sort((a, b) => (a.assignee?.name ?? '￿').localeCompare(b.assignee?.name ?? '￿'))
  }
}

export type AvenaPMTaskGroup = { key: string; tasks: AvenaPMTask[] }

function groupKey(task: AvenaPMTask, groupBy: Exclude<AvenaPMGroupBy, 'none'>): string {
  switch (groupBy) {
    case 'status':
      return task.status
    case 'classification':
      return task.classification
    case 'assignee':
      return task.assignee?.email ?? ''
  }
}

/** Keeps each group's tasks in their sorted order; groups follow the queue's own ordering. */
export function groupAvenaPMTasks(
  tasks: readonly AvenaPMTask[],
  groupBy: AvenaPMGroupBy
): AvenaPMTaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: '', tasks: [...tasks] }]
  }
  const groups = new Map<string, AvenaPMTask[]>()
  for (const task of tasks) {
    const key = groupKey(task, groupBy)
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  const order =
    groupBy === 'status'
      ? AVENAPM_STATUS_ORDER
      : groupBy === 'classification'
        ? AVENAPM_CLASSIFICATION_ORDER
        : null
  return [...groups.entries()]
    .map(([key, groupTasks]) => ({ key, tasks: groupTasks }))
    .sort((a, b) => {
      if (order) {
        return rankIn(order, a.key) - rankIn(order, b.key)
      }
      // Assignee groups: unassigned last, then by name.
      if (!a.key || !b.key) {
        return a.key ? -1 : b.key ? 1 : 0
      }
      const nameA = a.tasks[0]?.assignee?.name ?? a.key
      const nameB = b.tasks[0]?.assignee?.name ?? b.key
      return nameA.localeCompare(nameB)
    })
}

export type AvenaPMAssigneeOption = { email: string; name: string; count: number }

/** People who currently own a ticket in the loaded queue, busiest first. */
export function getAvenaPMAssigneeOptions(tasks: readonly AvenaPMTask[]): AvenaPMAssigneeOption[] {
  const byEmail = new Map<string, AvenaPMAssigneeOption>()
  for (const task of tasks) {
    if (!task.assignee) {
      continue
    }
    const key = task.assignee.email.toLowerCase()
    const current = byEmail.get(key)
    byEmail.set(key, {
      email: task.assignee.email,
      name: task.assignee.name,
      count: (current?.count ?? 0) + 1
    })
  }
  return [...byEmail.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function isDefaultAvenaPMTaskView(view: AvenaPMTaskView): boolean {
  return (
    view.workState === DEFAULT_AVENAPM_TASK_VIEW.workState &&
    view.assignee.kind === 'all' &&
    view.classifications.length === 0 &&
    view.search.trim() === ''
  )
}

// Device-local, like the Jira view mode, rather than synced through ui.set.
const STORAGE_KEY = 'topo.avenapm.task-view.v1'

function readAssigneeFilter(value: unknown): AvenaPMAssigneeFilter {
  const raw = asRecord(value)
  if (raw?.kind === 'me' || raw?.kind === 'unassigned') {
    return { kind: raw.kind }
  }
  if (raw?.kind === 'person' && typeof raw.email === 'string') {
    return { kind: 'person', email: raw.email }
  }
  return { kind: 'all' }
}

export function loadAvenaPMTaskView(): AvenaPMTaskView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_AVENAPM_TASK_VIEW
    }
    const stored = asRecord(JSON.parse(raw))
    if (!stored) {
      return DEFAULT_AVENAPM_TASK_VIEW
    }
    // Search is per-session; everything else restores. Unknown values fall back field by field.
    const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
      allowed.find((option) => option === value) ?? fallback
    return {
      workState: pick(
        stored.workState,
        ['open', 'unstarted', 'active', 'in_review', 'done', 'all'],
        DEFAULT_AVENAPM_TASK_VIEW.workState
      ),
      assignee: readAssigneeFilter(stored.assignee),
      classifications: Array.isArray(stored.classifications)
        ? stored.classifications.filter((value): value is string => typeof value === 'string')
        : [],
      sort: pick(
        stored.sort,
        [
          'triage',
          'created_desc',
          'created_asc',
          'updated_desc',
          'priority_desc',
          'status',
          'assignee'
        ],
        DEFAULT_AVENAPM_TASK_VIEW.sort
      ),
      groupBy: pick(
        stored.groupBy,
        ['none', 'status', 'assignee', 'classification'],
        DEFAULT_AVENAPM_TASK_VIEW.groupBy
      ),
      search: ''
    }
  } catch {
    return DEFAULT_AVENAPM_TASK_VIEW
  }
}

export function saveAvenaPMTaskView(view: AvenaPMTaskView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...view, search: '' }))
  } catch {
    // The live view stays usable when browser storage is unavailable or full.
  }
}
