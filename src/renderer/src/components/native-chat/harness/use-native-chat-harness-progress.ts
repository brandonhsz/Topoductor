import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/native-chat/status/structured-agent-session-status-feed'
import {
  harnessFlowProgress,
  type HarnessFlowProgress,
  type HarnessSessionLiveStatus
} from '../../../../../shared/harness/harness-flow-progress'
import type {
  HarnessRun,
  HarnessRunStatus,
  HarnessRunSummary
} from '../../../../../shared/harness/harness-run-types'

const isLive = (status: HarnessRunStatus): boolean => status === 'running' || status === 'waiting'

const belongsTo = (summary: HarnessRunSummary, sessionId: string): boolean =>
  summary.mode === 'chat' && summary.chatSessionId === sessionId

export type NativeChatHarnessFlow = {
  progress: HarnessFlowProgress
  answer: (decisionId: string, choice: string) => void
}

/** The live chat-mode Harness run this chat session drives; null otherwise. */
function useLiveHarnessRun(sessionId: string): HarnessRun | null {
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
  return run && isLive(run.status) ? run : null
}

/** What each running agent's chat says now: whether it asks the person, and its current tool. */
function useHarnessSessionsLiveStatus(
  worktreeId: string | null,
  sessionIds: string
): (sessionId: string) => HarnessSessionLiveStatus | null {
  const environmentId = useAppStore((state) =>
    runtimeEnvironmentIdOrLocalUnlessTwin(state, worktreeId)
  )
  const feed = useMemo(
    () => getStructuredAgentSessionStatusFeed(runtimeTargetForOwnerEnvironment(environmentId)),
    [environmentId]
  )
  // The feed updates its map in place, so a counter is the change signal.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!sessionIds) {
      return
    }
    const deactivate = feed.activate()
    const bump = (): void => setRevision((current) => current + 1)
    const offs = sessionIds.split(' ').map((id) => feed.subscribeSession(id, bump))
    bump()
    return () => {
      offs.forEach((off) => off())
      deactivate()
    }
  }, [feed, sessionIds])
  return useCallback(
    (sessionId: string) => {
      const summary = feed.getSnapshot().get(sessionId)
      if (!summary) {
        return null
      }
      const tool = summary.status === 'working' ? summary.toolName : undefined
      return {
        attention: summary.status === 'attention',
        activity: tool ? [tool, summary.toolInput].filter(Boolean).join(': ') : null
      }
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- revision is the feed's change signal.
    [feed, revision]
  )
}

export function useNativeChatHarnessProgress(sessionId: string): NativeChatHarnessFlow | null {
  const run = useLiveHarnessRun(sessionId)
  const runningSessions = (run?.steps ?? [])
    .flatMap((step) =>
      step.runner === 'topo' && step.status === 'running' && step.session?.kind === 'structured'
        ? [step.session.sessionId]
        : []
    )
    .join(' ')
  const liveStatus = useHarnessSessionsLiveStatus(run?.worktreeId ?? null, runningSessions)
  const runId = run?.id ?? null
  const answer = useCallback(
    (decisionId: string, choice: string) => {
      if (runId) {
        void window.api?.harness
          ?.answerDecision(runId, { decisionId, choice, text: '', fields: {} })
          .catch(() => {})
      }
    },
    [runId]
  )
  return useMemo(() => {
    const progress = run ? harnessFlowProgress(run, liveStatus) : null
    return progress ? { progress, answer } : null
  }, [run, liveStatus, answer])
}
