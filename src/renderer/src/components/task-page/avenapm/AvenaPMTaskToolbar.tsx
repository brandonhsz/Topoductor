import { ArrowDownUp, ChevronDown, Layers, Search, Tag, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import {
  AVENAPM_CLASSIFICATION_ORDER,
  isDefaultAvenaPMTaskView,
  type AvenaPMAssigneeFilter,
  type AvenaPMAssigneeOption,
  type AvenaPMGroupBy,
  type AvenaPMSort,
  type AvenaPMTaskView
} from './avenapm-task-view'
import {
  avenaPMClassificationLabel,
  avenaPMGroupOptions,
  avenaPMSortOptions,
  avenaPMWorkStateOptions
} from './avenapm-task-labels'

function assigneeValue(filter: AvenaPMAssigneeFilter): string {
  return filter.kind === 'person' ? `person:${filter.email}` : filter.kind
}

function assigneeFromValue(value: string): AvenaPMAssigneeFilter {
  if (value === 'me' || value === 'unassigned') {
    return { kind: value }
  }
  if (value.startsWith('person:')) {
    return { kind: 'person', email: value.slice('person:'.length) }
  }
  return { kind: 'all' }
}

export function AvenaPMTaskToolbar({
  view,
  onChange,
  assigneeOptions,
  myCount,
  unassignedCount,
  classificationCounts
}: {
  view: AvenaPMTaskView
  onChange: (next: AvenaPMTaskView) => void
  assigneeOptions: AvenaPMAssigneeOption[]
  myCount: number
  unassignedCount: number
  classificationCounts: ReadonlyMap<string, number>
}): React.JSX.Element {
  const t = useTranslate()
  const update = (patch: Partial<AvenaPMTaskView>): void => onChange({ ...view, ...patch })
  const assigneeLabel =
    view.assignee.kind === 'me'
      ? t('auto.components.TaskPage.avenapmAssigneeMe', 'Assigned to me')
      : view.assignee.kind === 'unassigned'
        ? t('auto.components.TaskPage.avenapmUnassigned', 'Unassigned')
        : view.assignee.kind === 'person'
          ? (assigneeOptions.find(
              (option) =>
                view.assignee.kind === 'person' &&
                option.email.toLowerCase() === view.assignee.email.toLowerCase()
            )?.name ?? view.assignee.email)
          : t('auto.components.TaskPage.avenapmAssigneeAnyone', 'Anyone')
  const classificationLabel =
    view.classifications.length === 0
      ? t('auto.components.TaskPage.avenapmClassAll', 'All types')
      : view.classifications.length === 1
        ? avenaPMClassificationLabel(t, view.classifications[0] ?? '')
        : t('auto.components.TaskPage.avenapmClassSome', '{{count}} types', {
            count: view.classifications.length
          })
  const sortLabel = avenaPMSortOptions(t).find((option) => option.id === view.sort)?.label
  const groupLabel = avenaPMGroupOptions(t).find((option) => option.id === view.groupBy)?.label

  return (
    <div className="flex flex-col gap-2 border-b border-border/50 bg-muted/35 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {avenaPMWorkStateOptions(t).map((option) => (
          <Button
            key={option.id}
            variant={view.workState === option.id ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => update({ workState: option.id })}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex w-60 max-w-full items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            density="compact"
            value={view.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder={t(
              'auto.components.TaskPage.avenapmSearch',
              'Search by ID, title or person'
            )}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs">
              <User className="size-3.5" />
              <span className="max-w-32 truncate">{assigneeLabel}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>
              {t('auto.components.TaskPage.avenapmSortAssignee', 'Assignee')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={assigneeValue(view.assignee)}
              onValueChange={(value) => update({ assignee: assigneeFromValue(value) })}
            >
              <DropdownMenuRadioItem value="all">
                {t('auto.components.TaskPage.avenapmAssigneeAnyone', 'Anyone')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="me">
                <span className="flex-1">
                  {t('auto.components.TaskPage.avenapmAssigneeMe', 'Assigned to me')}
                </span>
                <span className="text-2xs text-muted-foreground">{myCount}</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unassigned">
                <span className="flex-1">
                  {t('auto.components.TaskPage.avenapmUnassigned', 'Unassigned')}
                </span>
                <span className="text-2xs text-muted-foreground">{unassignedCount}</span>
              </DropdownMenuRadioItem>
              {assigneeOptions.length > 0 ? <DropdownMenuSeparator /> : null}
              {assigneeOptions.map((option) => (
                <DropdownMenuRadioItem key={option.email} value={`person:${option.email}`}>
                  <span className="min-w-0 flex-1 truncate" title={option.email}>
                    {option.name}
                  </span>
                  <span className="text-2xs text-muted-foreground">{option.count}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs">
              <Tag className="size-3.5" />
              <span className="max-w-28 truncate">{classificationLabel}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>
              {t('auto.components.TaskPage.avenapmGroupClassification', 'Classification')}
            </DropdownMenuLabel>
            {AVENAPM_CLASSIFICATION_ORDER.map((classification) => (
              <DropdownMenuCheckboxItem
                key={classification}
                checked={view.classifications.includes(classification)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  update({
                    classifications: checked
                      ? [...view.classifications, classification]
                      : view.classifications.filter((value) => value !== classification)
                  })
                }
              >
                <span className="flex-1">{avenaPMClassificationLabel(t, classification)}</span>
                <span className="text-2xs text-muted-foreground">
                  {classificationCounts.get(classification) ?? 0}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs">
              <ArrowDownUp className="size-3.5" />
              <span className="max-w-32 truncate">{sortLabel}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>
              {t('auto.components.TaskPage.avenapmSortBy', 'Sort by')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view.sort}
              onValueChange={(value) =>
                update({
                  sort:
                    avenaPMSortOptions(t).find((option) => option.id === value)?.id ??
                    ('triage' satisfies AvenaPMSort)
                })
              }
            >
              {avenaPMSortOptions(t).map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs">
              <Layers className="size-3.5" />
              <span className="max-w-28 truncate">{groupLabel}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>
              {t('auto.components.TaskPage.avenapmGroupBy', 'Group by')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view.groupBy}
              onValueChange={(value) =>
                update({
                  groupBy:
                    avenaPMGroupOptions(t).find((option) => option.id === value)?.id ??
                    ('none' satisfies AvenaPMGroupBy)
                })
              }
            >
              {avenaPMGroupOptions(t).map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {isDefaultAvenaPMTaskView(view) ? null : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              update({
                workState: 'open',
                assignee: { kind: 'all' },
                classifications: [],
                search: ''
              })
            }
          >
            <X className="size-3.5" />
            {t('auto.components.TaskPage.avenapmClearFilters', 'Clear filters')}
          </Button>
        )}
      </div>
    </div>
  )
}
