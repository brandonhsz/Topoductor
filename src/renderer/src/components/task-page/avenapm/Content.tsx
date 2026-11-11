import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Copy, ExternalLink, LoaderCircle, LogOut, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvenaPMIcon } from '@/components/icons/AvenaPMIcon'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { useAppStore } from '@/store'
import { formatRelativeTime } from '../task-page-source-context'
import type { AvenaPMTask, AvenaPMTaskStatus } from '../../../../../shared/avenapm/avenapm-types'
import {
  cancelAvenaPMConnect,
  connectAvenaPM,
  disconnectAvenaPM,
  markAvenaPMDisconnected,
  refreshAvenaPMStatus,
  useAvenaPMConnection
} from './avenapm-connection-store'
import { buildAvenaPMTaskPrompt, getAvenaPMTaskWorkspaceSeed } from './avenapm-task-workspace'

type StatusFilter = AvenaPMTaskStatus | 'open'

const CLASSIFICATION_TONE: Record<string, string> = {
  incendio: 'border-destructive/40 bg-destructive/10 text-destructive',
  bug: 'border-destructive/30 bg-muted/40 text-foreground',
  ux: 'border-border/60 bg-muted/40 text-foreground',
  feature: 'border-border/60 bg-muted/40 text-foreground',
  sin_clasificar: 'border-border/50 bg-muted/30 text-muted-foreground'
}

export function TaskPageAvenaPMContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const t = useTranslate()
  const { status, connecting, error } = useAvenaPMConnection()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [tasks, setTasks] = useState<AvenaPMTask[]>([])
  const [queueName, setQueueName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const connected = status?.connected === true

  useEffect(() => {
    void refreshAvenaPMStatus()
  }, [])

  useEffect(() => {
    if (!connected) {
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void window.api.avenapm
      .listTasks(statusFilter === 'open' ? {} : { status: statusFilter })
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result.ok) {
          setTasks(result.tasks)
          setQueueName(result.queueName)
          return
        }
        if (result.reason === 'unauthorized' || result.reason === 'not_connected') {
          markAvenaPMDisconnected()
        }
        setLoadError(result.message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [connected, statusFilter, refreshNonce])

  const openModal = useAppStore((s) => s.openModal)
  const primaryRepoId = model.selectedRepos[0]?.id
  const startWorkspace = useCallback(
    (task: AvenaPMTask) => {
      openModal('new-workspace-composer', {
        initialRepoId: primaryRepoId,
        prefilledName: getAvenaPMTaskWorkspaceSeed(task),
        telemetrySource: 'sidebar'
      })
    },
    [openModal, primaryRepoId]
  )

  const copyPrompt = useCallback(
    async (task: AvenaPMTask) => {
      try {
        await window.api.ui.writeClipboardText(buildAvenaPMTaskPrompt(task))
        toast.success(t('auto.components.TaskPage.avenapmPromptCopied', 'Ticket prompt copied'))
      } catch {
        toast.error(
          t('auto.components.TaskPage.avenapmPromptCopyFailed', 'Couldn’t copy the prompt')
        )
      }
    },
    [t]
  )

  const statusOptions = useMemo(
    (): { id: StatusFilter; label: string }[] => [
      { id: 'open', label: t('auto.components.TaskPage.avenapmStatusOpen', 'Open') },
      { id: 'por_hacer', label: t('auto.components.TaskPage.avenapmStatusTodo', 'To do') },
      {
        id: 'en_progreso',
        label: t('auto.components.TaskPage.avenapmStatusInProgress', 'In progress')
      },
      {
        id: 'en_revision',
        label: t('auto.components.TaskPage.avenapmStatusInReview', 'In review')
      },
      { id: 'terminado', label: t('auto.components.TaskPage.avenapmStatusDone', 'Done') }
    ],
    [t]
  )

  if (status === null) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <AvenaPMIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          {t('auto.components.TaskPage.avenapmConnectTitle', 'Connect AvenaPM')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {t(
            'auto.components.TaskPage.avenapmConnectDescription',
            'Sign in with your Avena Google account to browse the operation queue and start work from its tickets.'
          )}
        </p>
        {error ? <p className="mt-3 max-w-sm text-xs text-destructive">{error}</p> : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => void connectAvenaPM()} disabled={connecting}>
            {connecting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {connecting
              ? t('auto.components.TaskPage.avenapmConnecting', 'Waiting for browser sign-in…')
              : t('auto.components.TaskPage.avenapmSignIn', 'Sign in with Google')}
          </Button>
          {connecting ? (
            <Button variant="outline" onClick={cancelAvenaPMConnect}>
              {t('auto.components.TaskPage.avenapmCancel', 'Cancel')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => model.hideTaskSource('avenapm', 'AvenaPM')}>
              {t('auto.components.TaskPage.avenapmHide', 'Hide AvenaPM')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex min-h-10 flex-none flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {statusOptions.map((option) => (
            <Button
              key={option.id}
              variant={statusFilter === option.id ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setStatusFilter(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
          <span className="truncate">
            {queueName ? `${queueName} · ` : ''}
            {t('auto.components.TaskPage.shownCount', '{{count}} shown', {
              count: tasks.length,
              defaultValue_one: '{{count}} shown'
            })}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setRefreshNonce((n) => n + 1)}
                aria-label={t('auto.components.TaskPage.avenapmRefresh', 'Refresh')}
              >
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.components.TaskPage.avenapmRefresh', 'Refresh')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void disconnectAvenaPM()}
                aria-label={t('auto.components.TaskPage.avenapmSignOut', 'Sign out of AvenaPM')}
              >
                <LogOut className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.components.TaskPage.avenapmSignedInAs', 'Signed in as {{value0}}', {
                value0: status.user.email
              })}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
        {loadError ? (
          <p className="px-3 py-6 text-center text-sm text-destructive">{loadError}</p>
        ) : loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-14">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="px-3 py-14 text-center text-sm text-muted-foreground">
            {t('auto.components.TaskPage.avenapmEmpty', 'No tickets in this view.')}
          </p>
        ) : (
          <div className="divide-y divide-border/50">
            {tasks.map((task) => (
              <AvenaPMTaskRow
                key={task.id}
                task={task}
                onStart={startWorkspace}
                onCopyPrompt={copyPrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AvenaPMTaskRow({
  task,
  onStart,
  onCopyPrompt
}: {
  task: AvenaPMTask
  onStart: (task: AvenaPMTask) => void
  onCopyPrompt: (task: AvenaPMTask) => void
}): React.JSX.Element {
  const t = useTranslate()
  const label = task.shortId ?? task.title
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
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-medium',
              CLASSIFICATION_TONE[task.classification] ?? CLASSIFICATION_TONE.sin_clasificar
            )}
          >
            {task.classification.replace('_', ' ')}
          </span>
          <span className="shrink-0">{task.status.replace('_', ' ')}</span>
          {task.size ? <span className="shrink-0">· {task.size}</span> : null}
          <span className="min-w-0 truncate">
            · {task.assignee?.name ?? t('auto.components.TaskPage.avenapmUnassigned', 'Unassigned')}
          </span>
          {task.updatedAt ? (
            <span className="shrink-0">· {formatRelativeTime(task.updatedAt)}</span>
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
                {
                  value0: label
                }
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
                {
                  value0: label
                }
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
                {
                  value0: label
                }
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
