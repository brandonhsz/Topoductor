import React, { useMemo, useState } from 'react'
import { ExternalLink, Loader2, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { tuiAgentDisplayName } from '../../../../shared/agent-launch/catalog/tui-agent-display-names'
import type {
  HarnessPendingDecision,
  HarnessRun,
  HarnessRunStatus,
  HarnessRunStep,
  HarnessRunSummary
} from '../../../../shared/harness/harness-run-types'
import {
  HarnessFlowCanvas,
  type HarnessCanvasSelection,
  type HarnessNodeLiveStatus
} from './HarnessFlowCanvas'
import { HarnessStartFieldsForm, initialFieldValues } from './HarnessRunDialog'
import { revealHarnessSession } from './harness-session-reveal'
import { useHarnessRun } from './use-harness-data'

const STATUS_TONE: Record<HarnessRunStatus | HarnessNodeLiveStatus, string> = {
  running: 'text-primary',
  waiting: 'text-status-warning-text',
  completed: 'text-status-success',
  done: 'text-status-success',
  failed: 'text-destructive',
  stopped: 'text-muted-foreground'
}

function useStatusLabel(): (status: HarnessRunStatus | HarnessNodeLiveStatus) => string {
  const t = useTranslate()
  return (status) =>
    ({
      running: t('components.harness.status.running', 'Running'),
      waiting: t('components.harness.status.waiting', 'Waiting for you'),
      completed: t('components.harness.status.completed', 'Completed'),
      done: t('components.harness.status.done', 'Done'),
      failed: t('components.harness.status.failed', 'Failed'),
      stopped: t('components.harness.status.stopped', 'Stopped')
    })[status]
}

function nodeStatuses(run: HarnessRun): {
  statuses: Record<string, HarnessNodeLiveStatus>
  visits: Record<string, number>
} {
  const statuses: Record<string, HarnessNodeLiveStatus> = {}
  const visits: Record<string, number> = {}
  for (const step of run.steps) {
    visits[step.nodeId] = Math.max(visits[step.nodeId] ?? 0, step.visit)
    const previous = statuses[step.nodeId]
    if (previous === 'running' || previous === 'waiting') {
      continue
    }
    statuses[step.nodeId] = step.status
  }
  for (const decision of run.pending) {
    statuses[decision.nodeId] = 'waiting'
  }
  return { statuses, visits }
}

function DecisionCard({
  run,
  decision
}: {
  run: HarnessRun
  decision: HarnessPendingDecision
}): React.JSX.Element {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      decision.fields.map((field) => [
        field.key,
        run.vars[field.key] ?? initialFieldValues([field])[field.key] ?? ''
      ])
    )
  )
  const [sending, setSending] = useState(false)
  const send = (choice: string | null): void => {
    setSending(true)
    void window.api.harness
      .answerDecision(run.id, { decisionId: decision.id, choice, text, fields })
      .finally(() => setSending(false))
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-status-warning-border bg-status-warning-background p-3">
      <div>
        <p className="text-sm font-medium">{decision.title}</p>
        <p className="mt-1 text-xs whitespace-pre-wrap">{decision.prompt}</p>
      </div>
      {decision.context.map((entry) => (
        <details key={entry.key} className="rounded-md border border-border bg-background">
          <summary className="cursor-default px-2 py-1 font-mono text-2xs text-muted-foreground">
            {entry.key}
          </summary>
          <pre className="scrollbar-sleek max-h-80 overflow-auto px-2 pb-2 font-sans text-xs whitespace-pre-wrap">
            {entry.value}
          </pre>
        </details>
      ))}
      {decision.fields.length > 0 ? (
        <HarnessStartFieldsForm fields={decision.fields} values={fields} onChange={setFields} />
      ) : (
        <Textarea
          rows={4}
          value={text}
          placeholder={t('components.harness.decision.answer', 'Your answer (optional)')}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {(decision.choices.length > 0 ? decision.choices : [null]).map((choice, index) => (
          <Button
            key={choice ?? 'continue'}
            size="sm"
            variant={index === 0 ? 'default' : 'outline'}
            disabled={sending}
            onClick={() => send(choice)}
          >
            {choice ?? t('components.harness.decision.continue', 'Continue')}
          </Button>
        ))}
      </div>
    </section>
  )
}

function StepCard({ step }: { step: HarnessRunStep }): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useStatusLabel()
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        {step.status === 'running' ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{step.title}</span>
        <span className={cn('shrink-0 text-2xs', STATUS_TONE[step.status])}>
          {statusLabel(step.status)}
        </span>
      </div>
      <p className="text-2xs text-muted-foreground">
        {[
          step.agent ? tuiAgentDisplayName(step.agent) : null,
          t('components.harness.step.round', 'round {{n}}', { n: step.visit }),
          step.outcome ? `→ ${step.outcome}` : null
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {step.session ? (
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => void revealHarnessSession(step.session!)}
        >
          <ExternalLink />
          {step.status === 'running'
            ? t('components.harness.step.watch', 'Watch agent live')
            : t('components.harness.step.open', 'Open agent session')}
        </Button>
      ) : null}
      {step.error ? <p className="text-xs text-destructive">{step.error}</p> : null}
      {step.output ? (
        <pre className="scrollbar-sleek max-h-96 overflow-auto rounded-md bg-muted/40 p-2 font-sans text-xs whitespace-pre-wrap">
          {step.output}
        </pre>
      ) : null}
    </article>
  )
}

function RunDetail({ run }: { run: HarnessRun }): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useStatusLabel()
  const [selection, setSelection] = useState<HarnessCanvasSelection>(null)
  const { statuses, visits } = useMemo(() => nodeStatuses(run), [run])
  const selectedNode = selection?.kind === 'node' ? selection.id : null
  const steps = (
    selectedNode ? run.steps.filter((step) => step.nodeId === selectedNode) : run.steps
  ).toReversed()
  const live = run.status === 'running' || run.status === 'waiting'
  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium">{run.flowName}</span>
          <span className={cn('text-xs', STATUS_TONE[run.status])}>{statusLabel(run.status)}</span>
          <div className="ml-auto flex gap-1.5">
            {live ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => void window.api.harness.stopRun(run.id)}
              >
                <Square />
                {t('components.harness.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void window.api.harness.deleteRun(run.id)}
              >
                <Trash2 />
                {t('components.harness.deleteRun', 'Delete run')}
              </Button>
            )}
          </div>
        </div>
        {run.error ? (
          <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-destructive">
            {run.error}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <HarnessFlowCanvas
            key={run.id}
            flow={run.flow}
            editable={false}
            selection={selection}
            onSelect={setSelection}
            statuses={statuses}
            visits={visits}
          />
        </div>
      </section>
      <aside className="scrollbar-sleek flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-4">
        {run.pending.map((decision) => (
          <DecisionCard key={decision.id} run={run} decision={decision} />
        ))}
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            {selectedNode
              ? (run.flow.nodes.find((node) => node.id === selectedNode)?.title ?? selectedNode)
              : t('components.harness.timeline', 'Every step')}
          </span>
          {selectedNode ? (
            <Button variant="link" size="inline" onClick={() => setSelection(null)}>
              {t('components.harness.showAll', 'Show all')}
            </Button>
          ) : null}
        </div>
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('components.harness.noSteps', 'This node has not run yet.')}
          </p>
        ) : (
          steps.map((step) => <StepCard key={step.id} step={step} />)
        )}
      </aside>
    </>
  )
}

export function HarnessRunsView({
  runs,
  selectedRunId,
  onSelectRun
}: {
  runs: HarnessRunSummary[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  const statusLabel = useStatusLabel()
  const activeRunId = selectedRunId ?? runs[0]?.id ?? null
  const run = useHarnessRun(activeRunId)
  return (
    <div className="flex min-h-0 flex-1 border-t border-border">
      <aside className="scrollbar-sleek flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border p-2">
        {runs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            {t('components.harness.noRuns', 'Run a flow to watch its agents here.')}
          </p>
        ) : null}
        {runs.map((summary) => (
          <button
            key={summary.id}
            type="button"
            data-current={summary.id === activeRunId ? 'true' : undefined}
            onClick={() => onSelectRun(summary.id)}
            className={cn(
              'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent',
              summary.id === activeRunId && 'bg-accent'
            )}
          >
            <span className="w-full truncate text-[13px] font-medium">{summary.flowName}</span>
            <span className="flex w-full items-center gap-1.5 text-2xs">
              <span className={STATUS_TONE[summary.status]}>{statusLabel(summary.status)}</span>
              <span className="text-muted-foreground">
                {new Date(summary.createdAt).toLocaleString(locale)}
              </span>
            </span>
          </button>
        ))}
      </aside>
      {run ? <RunDetail key={run.id} run={run} /> : null}
    </div>
  )
}
