import React, { useMemo, useState } from 'react'
import {
  Bot,
  Copy,
  Flag,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  UserRound,
  FolderGit2,
  History
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/i18n/use-translate'
import type { HarnessFlow, HarnessNodeKind } from '../../../../shared/harness/harness-flow-types'
import { harnessFlowToMarkdown } from '../../../../shared/harness/harness-flow-markdown'
import { HarnessFlowCanvas, type HarnessCanvasSelection } from './HarnessFlowCanvas'
import { HarnessInspector } from './HarnessInspector'
import { HarnessFlowVersions } from './HarnessFlowVersions'
import { HarnessFlowConflictBanner } from './HarnessFlowConflictBanner'
import { rememberHarnessFlow } from './harness-last-flow'
import { useAppStore } from '@/store'
import {
  copyHarnessFlowForRepo,
  createEmptyHarnessFlow,
  createHarnessNode,
  duplicateHarnessFlow
} from './harness-flow-editing'
import { harnessFlowProblems } from '../../../../shared/harness/harness-flow-problems'
import { useHarnessFlowAutosave, useHarnessFlows, useHarnessFlowVersions } from './use-harness-data'
import type { HarnessWorkspaceContext } from './use-harness-workspace'

const ignoreFlowChange = (): void => {}

/** Local edits win over the saved copy until the selection moves to another flow. */
function openHarnessFlow(
  flows: HarnessFlow[] | null,
  selectedId: string | null,
  edits: HarnessFlow | null
): HarnessFlow | null {
  const saved = flows?.find((flow) => flow.id === selectedId) ?? flows?.[0] ?? null
  return edits && edits.id === (selectedId ?? saved?.id) ? edits : saved
}

export function HarnessFlowsView({
  workspace
}: {
  workspace: HarnessWorkspaceContext
}): React.JSX.Element {
  const t = useTranslate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<HarnessCanvasSelection>(null)
  const { edits, setEdits, saveState, change, flush, ...autosave } = useHarnessFlowAutosave()
  const [conflict, setConflict] = useState<{ flowId: string; summary: string } | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(true)
  const { flows, error, reload } = useHarnessFlows(workspace.repoId, (event, reloaded, list) => {
    const openFlowId = openHarnessFlow(list, selectedId, edits)?.id ?? null
    if (autosave.react(event, openFlowId, reloaded) === 'ask' && event) {
      setConflict({ flowId: event.flowId, summary: event.summary })
    }
  })

  const dropLocalEdits = (): void => {
    autosave.discard()
    setConflict(null)
  }

  const draft = openHarnessFlow(flows, selectedId, edits)
  const history = useHarnessFlowVersions(draft?.id ?? null, flush)
  const previewed = history.preview
  const addable: { kind: HarnessNodeKind; icon: typeof Bot; label: string }[] = [
    { kind: 'agent', icon: Bot, label: t('components.harness.add.agent', 'Agent') },
    { kind: 'human', icon: UserRound, label: t('components.harness.add.human', 'Your turn') },
    { kind: 'waves', icon: Layers, label: t('components.harness.add.waves', 'Waves') },
    { kind: 'end', icon: Flag, label: t('components.harness.add.end', 'End') }
  ]

  // Leaving a flow never saves edits held behind the agent-change prompt.
  const leaveFlow = (): Promise<void> => {
    if (conflict) {
      dropLocalEdits()
    }
    history.leavePreview()
    setSelection(null)
    return flush().catch(() => {})
  }

  const select = (flow: HarnessFlow): void => {
    void leaveFlow()
    setSelectedId(flow.id)
    setEdits(null)
  }

  const create = async (flow: HarnessFlow): Promise<void> => {
    await leaveFlow()
    const created = await window.api.harness.saveFlow(flow)
    setSelectedId(created.id)
    setEdits(created)
    setSelection(null)
  }

  const failed = (message: string) => (): void => void toast.error(message)

  const problems = useMemo(() => (draft ? harnessFlowProblems(draft) : []), [draft])

  if (error) {
    return <p className="p-5 text-sm text-destructive">{error}</p>
  }

  return (
    <div className="flex min-h-0 flex-1 border-t border-border">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t('components.harness.flows', 'Flows')}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('components.harness.newFlow', 'New flow')}
            onClick={() =>
              void create(
                createEmptyHarnessFlow({
                  name: t('components.harness.untitled', 'New flow'),
                  start: t('components.harness.startNode', 'Start'),
                  intent: t('components.harness.intentField', 'Intent'),
                  end: t('components.harness.endNode', 'End')
                })
              )
            }
          >
            <Plus />
          </Button>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {(flows ?? []).map((flow) => (
            <button
              key={flow.id}
              type="button"
              data-current={flow.id === draft?.id ? 'true' : undefined}
              onClick={() => select(flow)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent',
                flow.id === draft?.id && 'bg-accent'
              )}
            >
              <span className="w-full truncate text-[13px] font-medium">{flow.name}</span>
              <span className="text-2xs text-muted-foreground">
                {flow.scope.kind === 'repo'
                  ? t('components.harness.repoScope', 'This repository')
                  : t('components.harness.globalScope', 'All repositories')}
              </span>
            </button>
          ))}
        </div>
      </aside>
      {draft ? (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              {addable.map(({ kind, icon: Icon, label }) => (
                <Button
                  key={kind}
                  variant="outline"
                  size="xs"
                  disabled={previewed !== null}
                  onClick={() => {
                    const maxX = Math.max(0, ...draft.nodes.map((node) => node.position.x))
                    const node = createHarnessNode(draft, kind, { x: maxX + 300, y: 0 }, label)
                    change({ ...draft, nodes: [...draft.nodes, node] })
                    setSelection({ kind: 'node', id: node.id })
                  }}
                >
                  <Icon />
                  {label}
                </Button>
              ))}
              <span className="ml-auto text-2xs text-muted-foreground" aria-live="polite">
                {saveState === 'saving'
                  ? t('components.harness.saving', 'Saving…')
                  : saveState === 'error'
                    ? t('components.harness.saveFailed', 'Not saved')
                    : t('components.harness.saved', 'Saved')}
              </span>
              <Button
                size="icon-xs"
                aria-label={t('components.harness.versions.toggle', 'Version history')}
                aria-pressed={versionsOpen}
                variant={versionsOpen ? 'secondary' : 'ghost'}
                onClick={() => setVersionsOpen((open) => !open)}
              >
                <History />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('components.harness.moreActions', 'More actions')}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {workspace.repoId && draft.scope.kind === 'global' ? (
                    <DropdownMenuItem
                      onSelect={() => void create(copyHarnessFlowForRepo(draft, workspace.repoId!))}
                    >
                      <FolderGit2 />
                      {t('components.harness.customizeRepo', 'Customize for this repository')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() =>
                      void create(
                        duplicateHarnessFlow(
                          draft,
                          t('components.harness.copyName', '{{name}} (copy)', { name: draft.name })
                        )
                      )
                    }
                  >
                    <Copy />
                    {t('components.harness.duplicate', 'Duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard
                        .writeText(harnessFlowToMarkdown(draft))
                        .then(() =>
                          toast.success(
                            t('components.harness.copiedMarkdown', 'Copied as AGENTS.md')
                          )
                        )
                    }}
                  >
                    <Copy />
                    {t('components.harness.copyMarkdown', 'Copy as AGENTS.md')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      dropLocalEdits()
                      history.leavePreview()
                      void window.api.harness.deleteFlow(draft.id)
                      setSelectedId(null)
                      setEdits(null)
                    }}
                  >
                    <Trash2 />
                    {t('components.harness.deleteFlow', 'Delete flow')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="xs"
                disabled={problems.length > 0}
                onClick={() => {
                  void flush()
                    .catch(() => {})
                    .then(() => {
                      // The composer restores the remembered flow for this repo.
                      if (workspace.repoId) {
                        rememberHarnessFlow(workspace.repoId, draft.id)
                      }
                      useAppStore.getState().openModal('new-workspace-composer', {
                        telemetrySource: 'unknown',
                        ...(workspace.repoId ? { initialRepoId: workspace.repoId } : {})
                      })
                    })
                }}
              >
                <Play />
                {t('components.harness.openWorkspace', 'Open a workspace with this flow')}
              </Button>
            </div>
            {conflict && conflict.flowId === draft.id ? (
              <div className="shrink-0 border-b border-border px-3 py-2">
                <HarnessFlowConflictBanner
                  summary={conflict.summary}
                  onUseAgent={dropLocalEdits}
                  onKeepMine={() => {
                    setConflict(null)
                    void autosave.release().catch(() => {})
                  }}
                />
              </div>
            ) : null}
            {previewed ? (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <History className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  {t(
                    'components.harness.versions.previewing',
                    'Viewing “{{summary}}” · read-only',
                    { summary: previewed.summary }
                  )}
                </span>
              </div>
            ) : problems.length > 0 ? (
              <div className="shrink-0 border-b border-border bg-status-warning-background px-3 py-1.5 text-xs text-status-warning-text">
                {problems[0]}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              {previewed ? (
                <HarnessFlowCanvas
                  key={`${draft.id}:${previewed.id}`}
                  flow={previewed.flow}
                  editable={false}
                  selection={null}
                  onSelect={ignoreFlowChange}
                  onFlowChange={ignoreFlowChange}
                />
              ) : (
                <HarnessFlowCanvas
                  key={draft.id}
                  flow={draft}
                  editable
                  selection={selection}
                  onSelect={setSelection}
                  onFlowChange={change}
                />
              )}
            </div>
          </section>
          <aside className="flex w-80 shrink-0 flex-col border-l border-border">
            {previewed ? null : (
              <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-4">
                <HarnessInspector
                  flow={draft}
                  selection={selection}
                  onFlowChange={change}
                  onSelect={setSelection}
                />
              </div>
            )}
            {versionsOpen || previewed ? (
              <div
                className={cn(
                  'scrollbar-sleek overflow-y-auto p-4',
                  previewed ? 'min-h-0 flex-1' : 'max-h-1/2 shrink-0 border-t border-border'
                )}
              >
                <HarnessFlowVersions
                  versions={history.versions}
                  currentVersionId={history.currentVersionId}
                  previewVersionId={previewed?.id ?? null}
                  saving={history.saving || conflict !== null}
                  onPreview={(versionId) =>
                    void history
                      .openPreview(draft.id, versionId)
                      .catch(
                        failed(
                          t('components.harness.versions.loadFailed', 'Could not open that version')
                        )
                      )
                  }
                  onRestore={(versionId) =>
                    void history
                      .restore(draft.id, versionId)
                      .then(async () => {
                        await reload()
                        dropLocalEdits()
                        setSelection(null)
                      })
                      .catch(
                        failed(
                          t(
                            'components.harness.versions.restoreFailed',
                            'Could not restore that version'
                          )
                        )
                      )
                  }
                  onBackToCurrent={history.leavePreview}
                  onSaveVersion={(summary) =>
                    void history
                      .save(draft.id, summary)
                      .catch(
                        failed(
                          t('components.harness.versions.saveFailed', 'Could not save the version')
                        )
                      )
                  }
                />
              </div>
            ) : null}
          </aside>
        </>
      ) : null}
    </div>
  )
}
