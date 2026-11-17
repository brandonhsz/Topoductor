import React, { useState } from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMobilePageEscape } from '../mobile/use-mobile-page-escape'
import { HarnessFlowsView } from './HarnessFlowsView'
import { HarnessRunsView } from './HarnessRunsView'
import { useHarnessRuns } from './use-harness-data'
import { useHarnessWorkspace } from './use-harness-workspace'

type HarnessTab = 'flows' | 'runs'

export default function HarnessPage(): React.JSX.Element {
  const t = useTranslate()
  const closePage = useAppStore((state) => state.closeHarnessPage)
  useMobilePageEscape(closePage)
  const workspace = useHarnessWorkspace()
  const runs = useHarnessRuns()
  const [tab, setTab] = useState<HarnessTab>('flows')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const waiting = runs.filter((run) => run.status === 'waiting').length
  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center gap-4 px-3 pb-3 md:px-5"
        style={{ paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' }}
      >
        <h1 className="truncate text-base leading-8 font-semibold">
          {t('components.harness.title', 'Harness')}
        </h1>
        <Tabs value={tab} onValueChange={(value) => setTab(value === 'runs' ? 'runs' : 'flows')}>
          <TabsList>
            <TabsTrigger value="flows">{t('components.harness.tabs.flows', 'Flows')}</TabsTrigger>
            <TabsTrigger value="runs">
              {waiting > 0
                ? t('components.harness.tabs.runsWaiting', 'Runs ({{count}} waiting)', {
                    count: waiting
                  })
                : t('components.harness.tabs.runs', 'Runs')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7 shrink-0"
              onClick={closePage}
              aria-label={t('components.harness.close', 'Close Harness')}
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t('components.harness.closeTooltip', 'Close · Esc')}
          </TooltipContent>
        </Tooltip>
      </header>
      {tab === 'flows' ? (
        <HarnessFlowsView workspace={workspace} />
      ) : (
        <HarnessRunsView runs={runs} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
      )}
    </main>
  )
}
