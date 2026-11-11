import { describe, expect, it } from 'vitest'
import type { AvenaPMTask } from '../../../../../shared/avenapm/avenapm-types'
import {
  DEFAULT_AVENAPM_TASK_VIEW,
  filterAvenaPMTasks,
  getAvenaPMAssigneeOptions,
  groupAvenaPMTasks,
  sortAvenaPMTasks,
  type AvenaPMTaskView
} from './avenapm-task-view'

function task(
  shortId: string,
  status: string,
  assignee: string | null,
  createdAt: string,
  classification = 'bug'
): AvenaPMTask {
  return {
    id: shortId,
    shortId,
    title: `Ticket ${shortId}`,
    description: null,
    status,
    priority: null,
    size: null,
    classification,
    assignee: assignee ? { email: `${assignee}@avena.io`, name: assignee } : null,
    source: null,
    url: '',
    createdAt,
    updatedAt: createdAt,
    doneAt: null
  }
}

const TASKS = [
  task('OP-1', 'por_hacer', null, '2026-11-01T00:00:00Z', 'incendio'),
  task('OP-2', 'en_progreso', 'Ana', '2026-11-03T00:00:00Z'),
  task('OP-3', 'en_revision', 'Brandon', '2026-11-02T00:00:00Z', 'ux'),
  task('OP-4', 'terminado', 'Ana', '2026-10-30T00:00:00Z'),
  task('OP-5', 'por_hacer', 'Brandon', '2026-11-04T00:00:00Z')
]
const ME = 'brandon@avena.io'

function ids(view: Partial<AvenaPMTaskView>): string[] {
  return filterAvenaPMTasks(TASKS, { ...DEFAULT_AVENAPM_TASK_VIEW, ...view }, ME).map(
    (t) => t.shortId ?? ''
  )
}

describe('AvenaPM task view', () => {
  it('filters by work state', () => {
    expect(ids({ workState: 'open' })).toEqual(['OP-1', 'OP-2', 'OP-3', 'OP-5'])
    expect(ids({ workState: 'active' })).toEqual(['OP-2'])
    expect(ids({ workState: 'unstarted' })).toEqual(['OP-1', 'OP-5'])
    expect(ids({ workState: 'all' })).toEqual(['OP-1', 'OP-2', 'OP-3', 'OP-4', 'OP-5'])
  })

  it('filters by assignee: me, unassigned and a specific person', () => {
    expect(ids({ assignee: { kind: 'me' } })).toEqual(['OP-3', 'OP-5'])
    expect(ids({ assignee: { kind: 'unassigned' } })).toEqual(['OP-1'])
    expect(ids({ assignee: { kind: 'person', email: 'ANA@avena.io' } })).toEqual(['OP-2'])
  })

  it('combines classification and search filters', () => {
    expect(ids({ classifications: ['incendio', 'ux'] })).toEqual(['OP-1', 'OP-3'])
    expect(ids({ search: 'op-5' })).toEqual(['OP-5'])
    expect(ids({ search: 'ana' })).toEqual(['OP-2'])
  })

  it('sorts by creation date and by status, keeping triage order untouched', () => {
    const open = TASKS.filter((t) => t.status !== 'terminado')
    const order = (sort: AvenaPMTaskView['sort']): string[] =>
      sortAvenaPMTasks(open, sort).map((t) => t.shortId ?? '')
    expect(order('triage')).toEqual(['OP-1', 'OP-2', 'OP-3', 'OP-5'])
    expect(order('created_desc')).toEqual(['OP-5', 'OP-2', 'OP-3', 'OP-1'])
    expect(order('status')).toEqual(['OP-1', 'OP-5', 'OP-2', 'OP-3'])
  })

  it('groups by status in workflow order and by assignee with unassigned last', () => {
    expect(groupAvenaPMTasks(TASKS, 'status').map((g) => g.key)).toEqual([
      'por_hacer',
      'en_progreso',
      'en_revision',
      'terminado'
    ])
    expect(groupAvenaPMTasks(TASKS, 'assignee').map((g) => g.key)).toEqual([
      'Ana@avena.io',
      'Brandon@avena.io',
      ''
    ])
  })

  it('lists assignees busiest first with their ticket counts', () => {
    expect(getAvenaPMAssigneeOptions(TASKS).map((o) => `${o.name}:${o.count}`)).toEqual([
      'Ana:2',
      'Brandon:2'
    ])
  })
})
