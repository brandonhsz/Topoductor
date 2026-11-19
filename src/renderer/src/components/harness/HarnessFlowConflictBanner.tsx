import React from 'react'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

export type HarnessFlowConflictBannerProps = {
  summary: string
  onUseAgent(): void
  onKeepMine(): void
}

export function HarnessFlowConflictBanner({
  summary,
  onUseAgent,
  onKeepMine
}: HarnessFlowConflictBannerProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 size-4 shrink-0 text-status-warning-text" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-xs font-medium text-status-warning-text">
            {t('components.harness.conflict.title', 'The agent changed this flow')}
          </p>
          {summary ? <p className="text-xs text-muted-foreground">{summary}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="outline" size="xs" onClick={onKeepMine}>
          {t('components.harness.conflict.keepMine', 'Keep mine')}
        </Button>
        <Button size="xs" onClick={onUseAgent}>
          {t('components.harness.conflict.useAgent', "Show the agent's version")}
        </Button>
      </div>
    </div>
  )
}
