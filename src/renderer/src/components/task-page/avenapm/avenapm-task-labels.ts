import type { Translate } from '@/i18n/use-translate'
import type { AvenaPMGroupBy, AvenaPMSort, AvenaPMWorkState } from './avenapm-task-view'

export function avenaPMStatusLabel(t: Translate, status: string): string {
  switch (status) {
    case 'por_hacer':
      return t('auto.components.TaskPage.avenapmStatusTodo', 'To do')
    case 'en_progreso':
      return t('auto.components.TaskPage.avenapmStatusInProgress', 'In progress')
    case 'en_revision':
      return t('auto.components.TaskPage.avenapmStatusInReview', 'In review')
    case 'terminado':
      return t('auto.components.TaskPage.avenapmStatusDone', 'Done')
    case 'archivado':
      return t('auto.components.TaskPage.avenapmStatusArchived', 'Archived')
    default:
      return status.replaceAll('_', ' ')
  }
}

export function avenaPMClassificationLabel(t: Translate, classification: string): string {
  switch (classification) {
    case 'incendio':
      return t('auto.components.TaskPage.avenapmClassFire', 'Fire')
    case 'bug':
      return t('auto.components.TaskPage.avenapmClassBug', 'Bug')
    case 'ux':
      return t('auto.components.TaskPage.avenapmClassUx', 'UX')
    case 'feature':
      return t('auto.components.TaskPage.avenapmClassFeature', 'Feature')
    case 'sin_clasificar':
      return t('auto.components.TaskPage.avenapmClassUnclassified', 'Unclassified')
    default:
      return classification.replaceAll('_', ' ')
  }
}

export function avenaPMWorkStateOptions(t: Translate): { id: AvenaPMWorkState; label: string }[] {
  return [
    { id: 'open', label: t('auto.components.TaskPage.avenapmStatusOpen', 'Open') },
    { id: 'unstarted', label: t('auto.components.TaskPage.avenapmWorkUnstarted', 'Not started') },
    { id: 'active', label: t('auto.components.TaskPage.avenapmWorkActive', 'Being worked on') },
    { id: 'in_review', label: t('auto.components.TaskPage.avenapmStatusInReview', 'In review') },
    { id: 'done', label: t('auto.components.TaskPage.avenapmStatusDone', 'Done') },
    { id: 'all', label: t('auto.components.TaskPage.avenapmWorkAll', 'All') }
  ]
}

export function avenaPMSortOptions(t: Translate): { id: AvenaPMSort; label: string }[] {
  return [
    { id: 'triage', label: t('auto.components.TaskPage.avenapmSortTriage', 'Triage (AvenaPM)') },
    { id: 'created_desc', label: t('auto.components.TaskPage.avenapmSortNewest', 'Newest first') },
    { id: 'created_asc', label: t('auto.components.TaskPage.avenapmSortOldest', 'Oldest first') },
    {
      id: 'updated_desc',
      label: t('auto.components.TaskPage.avenapmSortUpdated', 'Recently updated')
    },
    { id: 'priority_desc', label: t('auto.components.TaskPage.avenapmSortPriority', 'Priority') },
    { id: 'status', label: t('auto.components.TaskPage.avenapmSortStatus', 'Status') },
    { id: 'assignee', label: t('auto.components.TaskPage.avenapmSortAssignee', 'Assignee') }
  ]
}

export function avenaPMGroupOptions(t: Translate): { id: AvenaPMGroupBy; label: string }[] {
  return [
    { id: 'none', label: t('auto.components.TaskPage.avenapmGroupNone', 'No grouping') },
    { id: 'status', label: t('auto.components.TaskPage.avenapmSortStatus', 'Status') },
    { id: 'assignee', label: t('auto.components.TaskPage.avenapmSortAssignee', 'Assignee') },
    {
      id: 'classification',
      label: t('auto.components.TaskPage.avenapmGroupClassification', 'Classification')
    }
  ]
}
