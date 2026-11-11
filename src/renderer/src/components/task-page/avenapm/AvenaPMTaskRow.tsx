import { ArrowRight, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { formatRelativeTime } from '../task-page-source-context'
import type { AvenaPMTask } from '../../../../../shared/avenapm/avenapm-types'
import { avenaPMClassificationLabel, avenaPMStatusLabel } from './avenapm-task-labels'

const CLASSIFICATION_TONE: Record<string, string> = {
  incendio: 'border-destructive/40 bg-destructive/10 text-destructive',
  bug: 'border-destructive/30 bg-muted/40 text-foreground',
  ux: 'border-border/60 bg-muted/40 text-foreground',
  feature: 'border-border/60 bg-muted/40 text-foreground',
  sin_clasificar: 'border-border/50 bg-muted/30 text-muted-foreground'
}

const STATUS_TONE: Record<string, string> = {
  por_hacer: 'border-border/60 text-muted-foreground',
  en_progreso: 'border-primary/40 bg-primary/10 text-foreground',
  en_revision: 'border-border/60 bg-accent text-foreground',
  terminado: 'border-border/50 text-muted-foreground line-through decoration-muted-foreground/40',
  archivado: 'border-border/50 text-muted-foreground'
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function AvenaPMTaskRow({
  task,
  isMine,
  onStart,
  onCopyPrompt
}: {
  task: AvenaPMTask
  isMine: boolean
  onStart: (task: AvenaPMTask) => void
  onCopyPrompt: (task: AvenaPMTask) => void
}): React.JSX.Element {
  const t = useTranslate()
  const label = task.shortId ?? task.title
  const unassigned = t('auto.components.TaskPage.avenapmUnassigned', 'Unassigned')
  return (
    <div className="group/row grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 transition hover:bg-accent">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {task.shortId ? (
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
              {task.shortId}
            </span>
          ) : null}
          <h3 className="min-w-0 truncate text-[13px] font-medium text-foreground">{task.title}</h3>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium',
              STATUS_TONE[task.status] ?? STATUS_TONE.por_hacer
            )}
          >
            {task.status === 'en_progreso' ? (
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            ) : null}
            {avenaPMStatusLabel(t, task.status)}
          </span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-medium',
              CLASSIFICATION_TONE[task.classification] ?? CLASSIFICATION_TONE.sin_clasificar
            )}
          >
            {avenaPMClassificationLabel(t, task.classification)}
          </span>
          {task.priority ? <span className="shrink-0">P{task.priority}</span> : null}
          {task.size ? <span className="shrink-0">· {task.size}</span> : null}
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-1',
              isMine && 'font-medium text-foreground'
            )}
            title={task.assignee?.email}
          >
            ·
            <span
              className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-[9px]"
              aria-hidden
            >
              {task.assignee ? initials(task.assignee.name) : '–'}
            </span>
            <span className="truncate">{task.assignee?.name ?? unassigned}</span>
          </span>
          {task.createdAt ? (
            <span className="shrink-0" title={task.createdAt}>
              ·{' '}
              {t('auto.components.TaskPage.avenapmCreatedAgo', 'created {{value0}}', {
                value0: formatRelativeTime(task.createdAt)
              })}
            </span>
          ) : null}
          {task.updatedAt && task.updatedAt !== task.createdAt ? (
            <span className="shrink-0" title={task.updatedAt}>
              ·{' '}
              {t('auto.components.TaskPage.avenapmUpdatedAgo', 'updated {{value0}}', {
                value0: formatRelativeTime(task.updatedAt)
              })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onCopyPrompt(task)}
              aria-label={t(
                'auto.components.TaskPage.avenapmCopyPrompt',
                'Copy prompt for {{value0}}',
                { value0: label }
              )}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t('auto.components.TaskPage.avenapmCopyPromptShort', 'Copy agent prompt')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onStart(task)}
              aria-label={t(
                'auto.components.TaskPage.ff90d0abc7',
                'Start workspace from {{value0}}',
                { value0: label }
              )}
            >
              <ArrowRight className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t('auto.components.TaskPage.9497f2787c', 'Start workspace')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => openAppHttpLink(task.url, { event })}
              aria-label={t(
                'auto.components.TaskPage.avenapmOpenTicket',
                'Open {{value0}} in AvenaPM',
                { value0: label }
              )}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t('auto.components.TaskPage.avenapmOpenInAvenaPM', 'Open in AvenaPM')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
