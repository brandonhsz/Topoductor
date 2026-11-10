import { observeLinearIssueRead } from '@/store/slices/linear/linear-issue-read-lifecycle'
import type { TaskPageLinearListEffectsModel } from './use-task-page-linear-list-effects'
import { useEffect } from 'react'
import {
  readLinkedLinearIssuesWithLimit,
  filterLinearIssuesForInTopoWorkspace
} from '@/components/task-page/linear/task-page-linear-in-topo-issues'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import { translate } from '@/i18n/i18n'

function isCurrentLinearRequest(
  requestRef: React.RefObject<{ signature: string; nonce: number } | null>,
  signature: string,
  nonce: number
): boolean {
  return requestRef.current?.signature === signature && requestRef.current?.nonce === nonce
}

export function useTaskPageLinearInTopoEffects(model: TaskPageLinearListEffectsModel) {
  const {
    fetchLinearIssue,
    refreshLinearIssue,
    linearConnected,
    selectedLinearWorkspaceId,
    taskSource,
    linearTaskSourceContext,
    taskResumeApplied,
    linearMode,
    setLinearIssues,
    linearIssueResult: { read: consumeLinearRead, setLoading: finishLinearLoading },
    setLinearIssuesHasMore,
    setLinearLoading,
    setLinearError,
    linearRefreshNonce,
    lastLinearRequestRef,
    inTopoLinkedLinearRefsSignature,
    inTopoLinkedLinearRefsRef
  } = model
  // Why: Has Worktree loads Linear tickets linked on local worktrees, not a Linear list/search query.
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'linear' || linearMode !== 'in-topo' || !linearConnected) {
      return
    }
    let cancelled = false
    const linkedRefs = inTopoLinkedLinearRefsRef.current
    const requestSignature = `in-topo::${selectedLinearWorkspaceId ?? 'default'}::${inTopoLinkedLinearRefsSignature}`
    const previousRequest = lastLinearRequestRef.current
    const isNewSignature = previousRequest?.signature !== requestSignature
    const forceRefresh = linearRefreshNonce > 0 && previousRequest?.nonce !== linearRefreshNonce
    lastLinearRequestRef.current = {
      nonce: linearRefreshNonce,
      signature: requestSignature
    }
    setLinearIssuesHasMore(false)
    setLinearError(null)
    if (linkedRefs.length === 0) {
      setLinearIssues([])
      setLinearLoading(false)
      return () => {
        cancelled = true
      }
    }
    if (isNewSignature) {
      setLinearIssues([])
    }
    setLinearLoading(true)
    const read = readLinkedLinearIssuesWithLimit(linkedRefs, (ref) => {
      const fetch = forceRefresh ? refreshLinearIssue : fetchLinearIssue
      return fetch(ref.identifier, ref.workspaceId ?? selectedLinearWorkspaceId, {
        sourceContext: ref.sourceContext ?? linearTaskSourceContext
      })
    })
    const release = observeLinearIssueRead(
      read,
      () =>
        !cancelled &&
        isCurrentLinearRequest(lastLinearRequestRef, requestSignature, linearRefreshNonce),
      (lease, view) => {
        if (view.kind === 'abandoned') {
          if (!cancelled) {
            finishLinearLoading(false)
          }
          return
        }
        const results = view.data
        const loaded = results?.filter(Boolean).length ?? 0
        consumeLinearRead(lease, view, {
          ...(results
            ? {
                data: filterLinearIssuesForInTopoWorkspace(
                  results.filter((issue): issue is LinearIssue => issue !== null),
                  selectedLinearWorkspaceId
                )
              }
            : {}),
          ...(view.kind === 'data'
            ? {
                error:
                  loaded === 0
                    ? translate(
                        'auto.components.TaskPage.linearHasWorktreeLoadFailed',
                        'Unable to load Linear issues linked to a Topo workspace.'
                      )
                    : loaded === results?.length
                      ? null
                      : translate(
                          'auto.components.TaskPage.linearHasWorktreePartialLoadFailed',
                          'Some Linear issues linked to a Topo workspace could not be loaded. Refresh to try again.'
                        )
              }
            : {}),
          loading: view.kind === 'loading'
        })
      }
    )
    return () => {
      cancelled = true
      release()
    }
  }, [
    consumeLinearRead,
    finishLinearLoading,
    fetchLinearIssue,
    inTopoLinkedLinearRefsSignature,
    inTopoLinkedLinearRefsRef,
    lastLinearRequestRef,
    linearConnected,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    refreshLinearIssue,
    selectedLinearWorkspaceId,
    setLinearError,
    setLinearIssues,
    setLinearIssuesHasMore,
    setLinearLoading,
    taskResumeApplied,
    taskSource
  ])
  return model
}
export type TaskPageLinearInTopoEffectsModel = ReturnType<typeof useTaskPageLinearInTopoEffects>
