import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, LogOut, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvenaPMIcon } from '@/components/icons/AvenaPMIcon'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AvenaPMTask } from '../../../../../shared/avenapm/avenapm-types'
import {
  cancelAvenaPMConnect,
  connectAvenaPM,
  disconnectAvenaPM,
  markAvenaPMDisconnected,
  refreshAvenaPMStatus,
  useAvenaPMConnection
} from './avenapm-connection-store'
import { buildAvenaPMTaskPrompt, getAvenaPMTaskWorkspaceSeed } from './avenapm-task-workspace'
import { AvenaPMTaskRow } from './AvenaPMTaskRow'
import { AvenaPMTaskToolbar } from './AvenaPMTaskToolbar'
import { avenaPMClassificationLabel, avenaPMStatusLabel } from './avenapm-task-labels'
import {
  filterAvenaPMTasks,
  getAvenaPMAssigneeOptions,
  groupAvenaPMTasks,
  loadAvenaPMTaskView,
  saveAvenaPMTaskView,
  sortAvenaPMTasks,
  workStateNeedsClosedTasks,
  type AvenaPMTaskView
} from './avenapm-task-view'

export function TaskPageAvenaPMContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const t = useTranslate()
  const { status, connecting, error } = useAvenaPMConnection()
  const [view, setView] = useState<AvenaPMTaskView>(loadAvenaPMTaskView)
  const includeClosed = workStateNeedsClosedTasks(view.workState)
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
      .listTasks({ includeClosed })
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
  }, [connected, includeClosed, refreshNonce])

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

  const changeView = useCallback((next: AvenaPMTaskView) => {
    setView(next)
    saveAvenaPMTaskView(next)
  }, [])

  const myEmail = status?.connected ? status.user.email : null
  // Counts describe the current work-state tab, so the menus show what each choice would leave.
  const tabTasks = useMemo(
    () =>
      filterAvenaPMTasks(
        tasks,
        { ...view, assignee: { kind: 'all' }, classifications: [], search: '' },
        myEmail
      ),
    [tasks, view, myEmail]
  )
  const assigneeOptions = useMemo(() => getAvenaPMAssigneeOptions(tabTasks), [tabTasks])
  const myCount = useMemo(
    () =>
      tabTasks.filter((task) => task.assignee?.email.toLowerCase() === myEmail?.toLowerCase())
        .length,
    [tabTasks, myEmail]
  )
  const unassignedCount = useMemo(
    () => tabTasks.filter((task) => !task.assignee).length,
    [tabTasks]
  )
  const classificationCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tabTasks) {
      counts.set(task.classification, (counts.get(task.classification) ?? 0) + 1)
    }
    return counts
  }, [tabTasks])
  const visibleTasks = useMemo(
    () => sortAvenaPMTasks(filterAvenaPMTasks(tasks, view, myEmail), view.sort),
    [tasks, view, myEmail]
  )
  const groups = useMemo(
    () => groupAvenaPMTasks(visibleTasks, view.groupBy),
    [visibleTasks, view.groupBy]
  )
  const groupLabel = (key: string): string => {
    if (view.groupBy === 'status') {
      return avenaPMStatusLabel(t, key)
    }
    if (view.groupBy === 'classification') {
      return avenaPMClassificationLabel(t, key)
    }
    return (
      groups.find((group) => group.key === key)?.tasks[0]?.assignee?.name ??
      t('auto.components.TaskPage.avenapmUnassigned', 'Unassigned')
    )
  }

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
      <div className="flex min-h-9 flex-none flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
        <div className="min-w-0 truncate text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          {queueName ?? t('auto.components.TaskPage.avenapmSource', 'AvenaPM')}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
          <span className="truncate">
            {t('auto.components.TaskPage.shownCount', '{{count}} shown', {
              count: visibleTasks.length,
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

      <AvenaPMTaskToolbar
        view={view}
        onChange={changeView}
        assigneeOptions={assigneeOptions}
        myCount={myCount}
        unassignedCount={unassignedCount}
        classificationCounts={classificationCounts}
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
        {loadError ? (
          <p className="px-3 py-6 text-center text-sm text-destructive">{loadError}</p>
        ) : loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-14">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : visibleTasks.length === 0 ? (
          <p className="px-3 py-14 text-center text-sm text-muted-foreground">
            {t('auto.components.TaskPage.avenapmEmpty', 'No tickets in this view.')}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key || 'all'}>
              {view.groupBy === 'none' ? null : (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-muted/60 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                  <span className="truncate">{groupLabel(group.key)}</span>
                  <span className="text-2xs">{group.tasks.length}</span>
                </div>
              )}
              <div className="divide-y divide-border/50">
                {group.tasks.map((task) => (
                  <AvenaPMTaskRow
                    key={task.id}
                    task={task}
                    isMine={
                      myEmail !== null &&
                      task.assignee?.email.toLowerCase() === myEmail.toLowerCase()
                    }
                    onStart={startWorkspace}
                    onCopyPrompt={copyPrompt}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
