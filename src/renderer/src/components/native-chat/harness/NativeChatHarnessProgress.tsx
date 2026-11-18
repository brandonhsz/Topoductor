import { useEffect, useId, useState } from 'react'
import { Check, ChevronDown, Circle, CircleAlert, CircleSlash, Loader2, X } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { tuiAgentDisplayName } from '../../../../../shared/agent-launch/catalog/tui-agent-display-names'
import type {
  HarnessFlowProgress,
  HarnessFlowProgressAgent,
  HarnessFlowProgressSubagents
} from '../../../../../shared/harness/harness-flow-progress'
import type {
  HarnessAgentSessionRef,
  HarnessStepStatus
} from '../../../../../shared/harness/harness-run-types'

type IconState = HarnessStepStatus | 'attention'

function StatusIcon({ status }: { status: IconState }): React.JSX.Element {
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
    case 'attention':
      return <CircleAlert aria-hidden="true" className={cn(className, 'text-chat-warning')} />
  }
}

const MINUTE_MS = 60_000

function agentStatusText(t: Translate, row: HarnessFlowProgressAgent, now: number): string {
  switch (row.status) {
    case 'running':
      return t('components.harness.chatProgress.status.working', 'working · {{minutes}} min', {
        minutes: Math.max(1, Math.round((now - row.startedAt) / MINUTE_MS))
      })
    case 'done':
      return row.outcome ?? t('components.harness.chatProgress.status.done', 'done')
    case 'failed':
      return t('components.harness.chatProgress.status.failed', 'failed')
    case 'waiting':
      return t('components.harness.chatProgress.status.waiting', 'pending')
    case 'stopped':
      return t('components.harness.chatProgress.status.stopped', 'stopped')
  }
}

function summaryText(t: Translate, progress: HarnessFlowProgress): string {
  if (progress.attention > 0) {
    return t('components.harness.chatProgress.summary.attention', '{{count}} agents need you', {
      count: progress.attention,
      defaultValue_one: '{{count}} agent needs you'
    })
  }
  if (progress.tabless > 0) {
    return t('components.harness.chatProgress.summary.tabless', '{{count}} agents without a tab', {
      count: progress.tabless,
      defaultValue_one: '{{count}} agent without a tab'
    })
  }
  const groups = progress.rows.filter((row) => row.kind === 'subagents')
  return t('components.harness.chatProgress.summary.done', '{{done}}/{{total}} done', {
    done: groups.reduce((sum, row) => sum + row.done, 0),
    total: groups.reduce((sum, row) => sum + row.total, 0)
  })
}

const finished = (status: HarnessStepStatus): boolean => status === 'done' || status === 'failed'

/** Minutes move while an agent works; nothing ticks once none does. */
function useMinuteClock(fixed: number | undefined, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (fixed !== undefined || !ticking) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS / 2)
    return () => clearInterval(timer)
  }, [fixed, ticking])
  return fixed ?? now
}

function SubagentsRow({ row }: { row: HarnessFlowProgressSubagents }): React.JSX.Element {
  const t = useTranslate()
  const working = row.agents.some((agent) => !finished(agent.status))
  return (
    <li data-title={row.group} data-status={working ? 'running' : 'done'} className="min-w-0">
      <div className="flex h-6 min-w-0 items-center gap-2">
        <StatusIcon status={working ? 'running' : 'done'} />
        <span className="min-w-0 truncate font-medium text-foreground">{row.group}</span>
        <span className="shrink-0">
          {t('components.harness.chatProgress.groupCount', '{{done}}/{{total}} done', {
            done: row.done,
            total: row.total
          })}
        </span>
        <Badge variant="referenceLabel">
          {t('components.harness.chatProgress.subagents', 'subagents')}
        </Badge>
      </div>
      <div className="ml-5.5 space-y-1">
        {row.agents.map((agent) => (
          <div key={agent.id} data-status={agent.status} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon status={agent.status} />
              <span className="min-w-0 truncate">{agent.title}</span>
            </div>
            {finished(agent.status) && agent.output.trim() ? (
              <p className="scrollbar-sleek ml-5.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-foreground">
                {agent.output.trim()}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </li>
  )
}

function AgentRow({
  row,
  now,
  onOpenSession,
  onAnswer
}: {
  row: HarnessFlowProgressAgent
  now: number
  onOpenSession: (session: HarnessAgentSessionRef) => void
  onAnswer: (decisionId: string, choice: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const agentName = row.agent ? (tuiAgentDisplayName(row.agent) ?? row.agent) : null
  const { session, decision } = row
  return (
    <li
      data-title={row.title}
      data-status={row.status}
      data-attention={row.attention ? 'true' : undefined}
      className={cn(
        'min-w-0 rounded-md',
        row.attention && 'border border-status-warning-border bg-status-warning-background p-1.5'
      )}
    >
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusIcon status={row.attention ? 'attention' : row.status} />
        <span className="min-w-0 truncate font-medium text-foreground">{row.title}</span>
        <span className={cn('shrink-0', row.attention && 'text-chat-warning')}>
          {agentStatusText(t, row, now)}
        </span>
        {agentName ? (
          <Badge variant="referenceLabel">
            {t('components.harness.chatProgress.topoAgent', '{{agent}} · Topo agent', {
              agent: agentName
            })}
          </Badge>
        ) : null}
        {session ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="ml-auto"
            onClick={() => onOpenSession(session)}
          >
            {row.attention
              ? t('components.harness.chatProgress.openAndReply', 'Open chat and reply')
              : t('components.harness.chatProgress.open', 'Open chat')}
          </Button>
        ) : null}
      </div>
      {row.activity ? <p className="ml-5.5 truncate font-mono">{row.activity}</p> : null}
      {decision ? (
        <div className="mt-1 ml-5.5 flex flex-wrap gap-1.5">
          {decision.choices.map((choice) => (
            <Button
              key={choice}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onAnswer(decision.id, choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  )
}

/** The chat's Harness flow: subagent blocks and the agents Topo runs without a tab, opened on demand. */
export function NativeChatHarnessProgress({
  progress,
  onOpenSession,
  onAnswer,
  now: fixedNow
}: {
  progress: HarnessFlowProgress | null
  onOpenSession: (session: HarnessAgentSessionRef) => void
  onAnswer: (decisionId: string, choice: string) => void
  /** Fixed clock for fixtures and tests. */
  now?: number
}): React.JSX.Element | null {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const working =
    progress?.rows.some((row) =>
      row.kind === 'agent'
        ? !finished(row.status)
        : row.agents.some((agent) => !finished(agent.status))
    ) ?? false
  const now = useMinuteClock(fixedNow, working)
  if (!progress) {
    return null
  }
  const attention = progress.attention > 0
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
              <StatusIcon status={attention ? 'attention' : working ? 'running' : 'done'} />
              <span className="min-w-0 truncate font-medium text-foreground">
                {progress.block
                  ? t('components.harness.chatProgress.title', '{{flow}} · {{block}}', {
                      flow: progress.flowName,
                      block: progress.block
                    })
                  : progress.flowName}
              </span>
              <span className={cn('ml-auto shrink-0', attention && 'text-chat-warning')}>
                {summaryText(t, progress)}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-3 shrink-0 transition-transform motion-reduce:transition-none',
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
              {progress.rows.map((row) =>
                row.kind === 'subagents' ? (
                  <SubagentsRow key={row.key} row={row} />
                ) : (
                  <AgentRow
                    key={row.key}
                    row={row}
                    now={now}
                    onOpenSession={onOpenSession}
                    onAnswer={onAnswer}
                  />
                )
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
