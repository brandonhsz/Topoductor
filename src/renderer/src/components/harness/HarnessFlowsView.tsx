import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FolderGit2
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
import { HarnessRunDialog } from './HarnessRunDialog'
import {
  copyHarnessFlowForRepo,
  createEmptyHarnessFlow,
  createHarnessNode,
  duplicateHarnessFlow,
  harnessFlowProblems
} from './harness-flow-editing'
import { useHarnessFlows } from './use-harness-data'
import type { HarnessWorkspaceContext } from './use-harness-workspace'

const SAVE_DELAY_MS = 600

export function HarnessFlowsView({
  workspace,
  onRunStarted
}: {
  workspace: HarnessWorkspaceContext
  onRunStarted: (runId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { flows, error } = useHarnessFlows(workspace.repoId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Local edits win over the saved copy until the selection moves to another flow.
  const [edits, setEdits] = useState<HarnessFlow | null>(null)
  const [selection, setSelection] = useState<HarnessCanvasSelection>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [runOpen, setRunOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<HarnessFlow | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const flow = pendingSave.current
    if (!flow) {
      return
    }
    pendingSave.current = null
    setSaveState('saving')
    try {
      await window.api.harness.saveFlow(flow)
      setSaveState('saved')
    } catch (caught) {
      setSaveState('error')
      throw caught
    }
  }, [])

  useEffect(() => () => void flush().catch(() => {}), [flush])

  const saved = flows?.find((flow) => flow.id === selectedId) ?? flows?.[0] ?? null
  const draft = edits && edits.id === (selectedId ?? saved?.id) ? edits : saved
  const addable: { kind: HarnessNodeKind; icon: typeof Bot; label: string }[] = [
    { kind: 'agent', icon: Bot, label: t('components.harness.add.agent', 'Agent') },
    { kind: 'human', icon: UserRound, label: t('components.harness.add.human', 'Your turn') },
    { kind: 'waves', icon: Layers, label: t('components.harness.add.waves', 'Waves') },
    { kind: 'end', icon: Flag, label: t('components.harness.add.end', 'End') }
  ]

  const change = useCallback(
    (next: HarnessFlow) => {
      setEdits(next)
      pendingSave.current = next
      setSaveState('saving')
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
      saveTimer.current = setTimeout(() => void flush().catch(() => {}), SAVE_DELAY_MS)
    },
    [flush]
  )

  const select = (flow: HarnessFlow): void => {
    void flush().catch(() => {})
    setSelectedId(flow.id)
    setEdits(null)
    setSelection(null)
  }

  const create = async (flow: HarnessFlow): Promise<void> => {
    await flush().catch(() => {})
    const created = await window.api.harness.saveFlow(flow)
    setSelectedId(created.id)
    setEdits(created)
    setSelection(null)
  }

  const problems = useMemo(() => (draft ? harnessFlowProblems(draft) : []), [draft])
  const startField = draft?.nodes.find((node) => node.kind === 'start')
  const startFields = useMemo(
    () => (startField?.kind === 'start' ? startField.fields : []),
    [startField]
  )

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
                      pendingSave.current = null
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
                disabled={problems.length > 0 || !workspace.worktreeId}
                onClick={() => setRunOpen(true)}
              >
                <Play />
                {t('components.harness.runFlow', 'Run')}
              </Button>
            </div>
            {problems.length > 0 || !workspace.worktreeId ? (
              <div className="shrink-0 border-b border-border bg-status-warning-background px-3 py-1.5 text-xs text-status-warning-text">
                {!workspace.worktreeId
                  ? t(
                      'components.harness.noWorkspace',
                      'Open a workspace in the sidebar to run this flow in it.'
                    )
                  : problems[0]}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <HarnessFlowCanvas
                key={draft.id}
                flow={draft}
                editable
                selection={selection}
                onSelect={setSelection}
                onFlowChange={change}
              />
            </div>
          </section>
          <aside className="scrollbar-sleek w-80 shrink-0 overflow-y-auto border-l border-border p-4">
            <HarnessInspector
              flow={draft}
              selection={selection}
              onFlowChange={change}
              onSelect={setSelection}
            />
          </aside>
          <HarnessRunDialog
            open={runOpen}
            onOpenChange={setRunOpen}
            flowName={draft.name}
            workspaceName={workspace.name}
            fields={startFields}
            onStart={async (fields) => {
              await flush()
              const run = await window.api.harness.startRun({
                flowId: draft.id,
                worktreeId: workspace.worktreeId!,
                fields
              })
              setRunOpen(false)
              onRunStarted(run.id)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
