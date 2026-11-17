import { useEffect, useMemo, useState } from 'react'
import {
  harnessSubagentProgress,
  type HarnessSubagentProgress
} from '../../../../../shared/harness/harness-subagent-contract'
import type {
  HarnessRun,
  HarnessRunStatus,
  HarnessRunSummary
} from '../../../../../shared/harness/harness-run-types'

const isLive = (status: HarnessRunStatus): boolean => status === 'running' || status === 'waiting'

const belongsTo = (summary: HarnessRunSummary, sessionId: string): boolean =>
  summary.mode === 'chat' && summary.chatSessionId === sessionId

/** Subagent progress of the live chat-mode Harness run this chat session drives; null otherwise. */
export function useNativeChatHarnessProgress(sessionId: string): HarnessSubagentProgress | null {
  const [state, setState] = useState<{ sessionId: string; run: HarnessRun } | null>(null)
  useEffect(() => {
    // Hosts and shells without the Harness bridge show no progress.
    const harness = window.api?.harness
    if (!harness) {
      return
    }
    let alive = true
    let liveRunId: string | null = null
    // Only the newest read may write, so a slow older read never overwrites fresher state.
    let latest: object | null = null
    const load = (runId: string): void => {
      const ticket = {}
      latest = ticket
      harness
        .getRun(runId)
        .then((run) => {
          if (alive && ticket === latest) {
            setState(run ? { sessionId, run } : null)
          }
        })
        .catch(() => {})
    }
    const consider = (summary: HarnessRunSummary): void => {
      if (!belongsTo(summary, sessionId)) {
        return
      }
      if (isLive(summary.status)) {
        liveRunId = summary.id
        load(summary.id)
      } else if (summary.id === liveRunId) {
        liveRunId = null
        latest = null
        setState(null)
      }
    }
    harness
      .listRuns()
      .then((runs) => {
        const live = runs
          .filter((run) => belongsTo(run, sessionId) && isLive(run.status))
          .sort((a, b) => b.createdAt - a.createdAt)[0]
        if (alive && live && liveRunId === null) {
          consider(live)
        }
      })
      .catch(() => {})
    const off = harness.onRunChanged(consider)
    return () => {
      alive = false
      off()
    }
  }, [sessionId])
  const run = state?.sessionId === sessionId ? state.run : null
  return useMemo(() => (run && isLive(run.status) ? harnessSubagentProgress(run) : null), [run])
}
