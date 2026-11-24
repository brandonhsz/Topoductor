import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { HarnessFlow } from '../../../../shared/harness/harness-flow-types'
import type {
  HarnessFlowChange,
  HarnessFlowVersion,
  HarnessFlowVersionSummary
} from '../../../../shared/harness/harness-flow-version-types'
import { harnessFlowChangeReaction, type HarnessFlowChangeReaction } from './harness-flow-conflict'
import type { HarnessRun, HarnessRunSummary } from '../../../../shared/harness/harness-run-types'

/** `onChange` gets each `harness:flowsChanged` payload, the refetch it triggered and the flows it shows now. */
export function useHarnessFlows(
  repoId: string | null,
  onChange?: (
    change: HarnessFlowChange | null,
    reloaded: Promise<void>,
    flows: HarnessFlow[] | null
  ) => void
): {
  flows: HarnessFlow[] | null
  error: string | null
  reload: () => Promise<void>
} {
  const [flows, setFlows] = useState<HarnessFlow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    // Hosts and shells without the Harness bridge (older preloads, partial API stubs) show no flows.
    const harness = window.api?.harness
    if (!harness) {
      setFlows([])
      return Promise.resolve()
    }
    return harness
      .listFlows(repoId)
      .then((next) => {
        setFlows(next)
        setError(null)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught))
      )
  }, [repoId])
  const notify = useEffectEvent((change: HarnessFlowChange | null, reloaded: Promise<void>) =>
    onChange?.(change, reloaded, flows)
  )
  useEffect(() => {
    void reload()
    return window.api?.harness?.onFlowsChanged((change) => notify(change, reload()))
  }, [reload])
  return { flows, error, reload }
}

const SAVE_DELAY_MS = 600

/** `held`: local edits wait behind the agent-change prompt and are not being saved. */
export type HarnessFlowSaveState = 'saved' | 'saving' | 'held' | 'error'

/** Debounced autosave of the open flow's local edits; `hold` keeps them unsaved until `release`. */
export function useHarnessFlowAutosave(): {
  edits: HarnessFlow | null
  setEdits: (edits: HarnessFlow | null) => void
  saveState: HarnessFlowSaveState
  change: (next: HarnessFlow) => void
  flush: () => Promise<void>
  discard: () => void
  /** Applies `harnessFlowChangeReaction`: 'ask' holds the autosave, 'reload' drops stored edits. */
  react: (
    change: HarnessFlowChange | null,
    openFlowId: string | null,
    reloaded: Promise<void>
  ) => HarnessFlowChangeReaction
  release: () => Promise<void>
} {
  // Local edits win over the saved copy until the selection moves to another flow.
  const [edits, setEdits] = useState<HarnessFlow | null>(null)
  const [saveState, setSaveState] = useState<HarnessFlowSaveState>('saved')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<HarnessFlow | null>(null)
  const saveInFlight = useRef(false)
  const held = useRef(false)

  const cancelTimer = (): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const flow = pendingSave.current
    if (!flow || held.current) {
      return
    }
    pendingSave.current = null
    saveInFlight.current = true
    setSaveState('saving')
    try {
      await window.api.harness.saveFlow(flow)
    } catch (caught) {
      saveInFlight.current = false
      setSaveState('error')
      throw caught
    }
    saveInFlight.current = false
    setSaveState('saved')
  }, [])

  useEffect(() => () => void flush().catch(() => {}), [flush])

  const change = useCallback(
    (next: HarnessFlow) => {
      setEdits(next)
      pendingSave.current = next
      setSaveState(held.current ? 'held' : 'saving')
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
      if (!held.current) {
        saveTimer.current = setTimeout(() => void flush().catch(() => {}), SAVE_DELAY_MS)
      }
    },
    [flush]
  )

  // Unsaved means not stored yet: a pending timer or a save in flight, not merely `edits`.
  const hasUnsavedEdits = (): boolean => pendingSave.current !== null || saveInFlight.current

  return {
    edits,
    setEdits,
    saveState,
    change,
    flush,
    discard: () => {
      cancelTimer()
      pendingSave.current = null
      held.current = false
      setEdits(null)
      setSaveState('saved')
    },
    react: (change, openFlowId, reloaded) => {
      const reaction = harnessFlowChangeReaction({
        change,
        openFlowId,
        hasLocalEdits: hasUnsavedEdits()
      })
      if (reaction === 'ask') {
        held.current = true
        cancelTimer()
        setSaveState('held')
      } else if (reaction === 'reload') {
        // Drop the local copy only once the fresh one is in, unless the person edited meanwhile.
        void reloaded.then(() => {
          if (!hasUnsavedEdits()) {
            setEdits(null)
          }
        })
      }
      return reaction
    },
    release: () => {
      held.current = false
      return flush()
    }
  }
}

/** Saved versions of the open flow and the one previewed read-only; state of other flows is ignored. */
export function useHarnessFlowVersions(
  flowId: string | null,
  flush: () => Promise<void>
): {
  versions: HarnessFlowVersionSummary[]
  currentVersionId: string | null
  preview: HarnessFlowVersion | null
  refresh: (flowId: string) => Promise<void>
  openPreview: (flowId: string, versionId: string) => Promise<void>
  leavePreview: () => void
  saving: boolean
  save: (flowId: string, summary: string) => Promise<void>
  restore: (flowId: string, versionId: string) => Promise<void>
} {
  const [loaded, setLoaded] = useState<{
    flowId: string
    versions: HarnessFlowVersionSummary[]
  } | null>(null)
  const [preview, setPreview] = useState<HarnessFlowVersion | null>(null)
  const previewRequest = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Restoring adds no version, so the restored one stays current until a newer version appears.
  const [restored, setRestored] = useState<{
    flowId: string
    versionId: string
    newestAtRestore: string | null
  } | null>(null)
  const refresh = useCallback(async (id: string): Promise<void> => {
    const versions = await window.api.harness.listFlowVersions(id)
    setLoaded({ flowId: id, versions })
  }, [])
  useEffect(() => {
    if (!flowId) {
      return
    }
    const load = (): void => void refresh(flowId).catch(() => {})
    load()
    return window.api?.harness?.onFlowsChanged((change) => {
      if (!change || change.flowId === flowId) {
        load()
      }
    })
  }, [flowId, refresh])
  const versions = loaded?.flowId === flowId ? loaded.versions : []
  const leavePreview = (): void => {
    previewRequest.current = null
    setPreview(null)
  }
  return {
    versions,
    currentVersionId:
      restored?.flowId === flowId && restored.newestAtRestore === (versions[0]?.id ?? null)
        ? restored.versionId
        : (versions[0]?.id ?? null),
    preview: preview?.flowId === flowId ? preview : null,
    refresh,
    openPreview: async (id, versionId) => {
      previewRequest.current = versionId
      const version = await window.api.harness.getFlowVersion(id, versionId)
      // A slower earlier request never replaces the version picked last.
      if (version && previewRequest.current === versionId) {
        setPreview(version)
      }
    },
    leavePreview,
    saving,
    save: async (id, summary) => {
      setSaving(true)
      try {
        // Versions snapshot the stored flow, so pending edits go in first.
        await flush()
        await window.api.harness.saveFlowVersion(id, summary)
      } catch (caught) {
        setSaving(false)
        throw caught
      }
      setSaving(false)
      await refresh(id)
    },
    restore: async (id, versionId) => {
      await flush()
      await window.api.harness.restoreFlowVersion(id, versionId)
      leavePreview()
      const latest = await window.api.harness.listFlowVersions(id)
      setLoaded({ flowId: id, versions: latest })
      setRestored({ flowId: id, versionId, newestAtRestore: latest[0]?.id ?? null })
    }
  }
}

export function useHarnessRuns(): HarnessRunSummary[] {
  const [runs, setRuns] = useState<HarnessRunSummary[]>([])
  useEffect(() => {
    let alive = true
    void window.api.harness.listRuns().then((next) => alive && setRuns(next))
    const off = window.api.harness.onRunChanged((changed) => {
      setRuns((current) => {
        const rest = current.filter((run) => run.id !== changed.id)
        return [changed, ...rest].sort((a, b) => b.createdAt - a.createdAt)
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return runs
}

/** Refetches the full run whenever its summary changes. */
export function useHarnessRun(runId: string | null): HarnessRun | null {
  const [run, setRun] = useState<HarnessRun | null>(null)
  useEffect(() => {
    if (!runId) {
      setRun(null)
      return
    }
    let alive = true
    // Only the newest request may write, so a slow older read never overwrites fresher state.
    let latest: object | null = null
    const load = (): void => {
      const ticket = {}
      latest = ticket
      void window.api.harness.getRun(runId).then((next) => {
        if (alive && ticket === latest) {
          setRun(next)
        }
      })
    }
    load()
    const off = window.api.harness.onRunChanged((changed) => {
      if (changed.id === runId) {
        load()
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [runId])
  return run
}
