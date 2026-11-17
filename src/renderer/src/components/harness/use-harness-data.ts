import { useCallback, useEffect, useState } from 'react'
import type { HarnessFlow } from '../../../../shared/harness/harness-flow-types'
import type { HarnessRun, HarnessRunSummary } from '../../../../shared/harness/harness-run-types'

export function useHarnessFlows(repoId: string | null): {
  flows: HarnessFlow[] | null
  error: string | null
  reload: () => void
} {
  const [flows, setFlows] = useState<HarnessFlow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    window.api.harness
      .listFlows(repoId)
      .then((next) => {
        setFlows(next)
        setError(null)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught))
      )
  }, [repoId])
  useEffect(() => {
    reload()
    return window.api.harness.onFlowsChanged(reload)
  }, [reload])
  return { flows, error, reload }
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
