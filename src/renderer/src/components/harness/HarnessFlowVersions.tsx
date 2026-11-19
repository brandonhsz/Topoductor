import React, { useContext, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Save, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TranslationScopeContext, useTranslate } from '@/i18n/use-translate'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { cn } from '@/lib/utils'
import type { HarnessFlowVersionSummary } from '../../../../shared/harness/harness-flow-version-types'

export type HarnessFlowVersionsProps = {
  /** Newest first, as the version store lists them. */
  versions: HarnessFlowVersionSummary[]
  currentVersionId: string | null
  previewVersionId: string | null
  onPreview(versionId: string): void
  onRestore(versionId: string): void
  onBackToCurrent(): void
  onSaveVersion(summary: string): void
  saving?: boolean
}

const VERSION_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }

export function HarnessFlowVersions({
  versions,
  currentVersionId,
  previewVersionId,
  onPreview,
  onRestore,
  onBackToCurrent,
  onSaveVersion,
  saving = false
}: HarnessFlowVersionsProps): React.JSX.Element {
  const t = useTranslate()
  // Read from context so isolated renders without I18nProvider still format dates.
  const intlLocale = useContext(TranslationScopeContext)?.intlLocale ?? 'en'
  const [summary, setSummary] = useState('')
  const trimmed = summary.trim()
  const baseIndex = versions.findIndex(
    (version) => version.id === (previewVersionId ?? currentVersionId)
  )
  const older = baseIndex !== -1 ? versions[baseIndex + 1] : undefined
  const newer = baseIndex > 0 ? versions[baseIndex - 1] : undefined

  const save = (): void => {
    if (trimmed === '' || saving) {
      return
    }
    onSaveVersion(trimmed)
    setSummary('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('components.harness.versions.title', 'Versions')}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('components.harness.versions.previous', 'Previous version')}
            disabled={!older}
            onClick={() => older && onPreview(older.id)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('components.harness.versions.next', 'Next version')}
            disabled={!newer}
            onClick={() => newer && onPreview(newer.id)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {previewVersionId ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" onClick={() => onRestore(previewVersionId)}>
            <RotateCcw />
            {t('components.harness.versions.restore', 'Restore')}
          </Button>
          <Button variant="outline" size="xs" onClick={onBackToCurrent}>
            <Undo2 />
            {t('components.harness.versions.backToCurrent', 'Back to current')}
          </Button>
        </div>
      ) : null}

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('components.harness.versions.empty', 'No saved versions yet.')}
        </p>
      ) : (
        <ul
          aria-label={t('components.harness.versions.list', 'Versions')}
          className="flex flex-col gap-0.5"
        >
          {versions.map((version) => {
            const isCurrent = version.id === currentVersionId
            const isPreview = version.id === previewVersionId
            return (
              <li key={version.id} aria-current={isCurrent ? 'true' : undefined}>
                <button
                  type="button"
                  onClick={() => onPreview(version.id)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent',
                    isPreview && 'bg-accent'
                  )}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {version.summary}
                    </span>
                    {isCurrent ? (
                      <span className="shrink-0 rounded border border-border px-1 text-2xs text-muted-foreground">
                        {t('components.harness.versions.current', 'Current')}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                    <span>
                      {version.author === 'agent'
                        ? t('components.harness.versions.author.agent', 'Agent')
                        : t('components.harness.versions.author.person', 'You')}
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={new Date(version.createdAt).toISOString()}>
                      {uiDateTimeFormat(VERSION_DATE, intlLocale).format(version.createdAt)}
                    </time>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="flex flex-col gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Input
          value={summary}
          placeholder={t('components.harness.versions.summaryPlaceholder', 'What changed?')}
          aria-label={t('components.harness.versions.summaryLabel', 'Version summary')}
          onChange={(event) => setSummary(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={trimmed === '' || saving}
        >
          <Save />
          {t('components.harness.versions.save', 'Save version')}
        </Button>
      </form>
    </div>
  )
}
