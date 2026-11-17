import { useId, useState } from 'react'
import { Check, ChevronDown, Circle, CircleSlash, Loader2, X } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import type { HarnessSubagentProgress } from '../../../../../shared/harness/harness-subagent-contract'
import type { HarnessStepStatus } from '../../../../../shared/harness/harness-run-types'

function statusLabel(t: Translate, status: HarnessStepStatus): string {
  switch (status) {
    case 'running':
      return t('components.harness.chatProgress.status.running', 'Running')
    case 'waiting':
      return t('components.harness.chatProgress.status.waiting', 'Waiting')
    case 'done':
      return t('components.harness.chatProgress.status.done', 'Done')
    case 'failed':
      return t('components.harness.chatProgress.status.failed', 'Failed')
    case 'stopped':
      return t('components.harness.chatProgress.status.stopped', 'Stopped')
  }
}

function StatusIcon({ status }: { status: HarnessStepStatus }): React.JSX.Element {
  const className = 'size-3.5 shrink-0'
  switch (status) {
    case 'running':
      return (
        <Loader2
          aria-hidden="true"
          className={cn(className, 'animate-spin text-muted-foreground motion-reduce:animate-none')}
        />
      )
    case 'done':
      return <Check aria-hidden="true" className={cn(className, 'text-status-success')} />
    case 'failed':
      return <X aria-hidden="true" className={cn(className, 'text-destructive')} />
    case 'stopped':
      return <CircleSlash aria-hidden="true" className={cn(className, 'text-muted-foreground')} />
    case 'waiting':
      return <Circle aria-hidden="true" className={cn(className, 'text-muted-foreground')} />
  }
}

const finished = (status: HarnessStepStatus): boolean => status === 'done' || status === 'failed'

/** The Harness subagents of the current block: one line, expandable to each agent and its answer. */
export function NativeChatHarnessProgress({
  progress
}: {
  progress: HarnessSubagentProgress | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (!progress) {
    return null
  }
  const working = progress.agents.some((agent) => !finished(agent.status))
  return (
    <div
      data-native-chat-harness-progress="true"
      className="shrink-0 bg-chat-pane px-3 pt-2 sm:px-4"
    >
      <div className="mx-auto w-full max-w-(--chat-content-max-width)">
        <div className="overflow-hidden rounded-lg border border-border bg-muted/50 text-xs text-muted-foreground shadow-xs">
          <div className="flex h-8 items-center px-1.5">
            <button
              type="button"
              className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((current) => !current)}
            >
              <StatusIcon status={working ? 'running' : 'done'} />
              <span className="min-w-0 truncate font-medium text-foreground">
                {t(
                  'components.harness.chatProgress.summary',
                  '{{group}}: {{done}}/{{total}} done',
                  {
                    group: progress.group,
                    done: progress.done,
                    total: progress.total
                  }
                )}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'ml-auto size-3 shrink-0 transition-transform motion-reduce:transition-none',
                  expanded && 'rotate-180'
                )}
              />
            </button>
          </div>
          {expanded ? (
            <ul
              id={listId}
              role="list"
              className="scrollbar-sleek max-h-72 space-y-1.5 overflow-y-auto border-t border-border px-3 py-2"
            >
              {progress.agents.map((agent, index) => (
                <li key={`${index}:${agent.title}`} data-status={agent.status} className="min-w-0">
                  <div className="flex h-6 min-w-0 items-center gap-2">
                    <StatusIcon status={agent.status} />
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {agent.title}
                    </span>
                    <span className="ml-auto shrink-0">{statusLabel(t, agent.status)}</span>
                  </div>
                  {finished(agent.status) && agent.output.trim() ? (
                    <p className="scrollbar-sleek ml-5.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-foreground">
                      {agent.output.trim()}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
