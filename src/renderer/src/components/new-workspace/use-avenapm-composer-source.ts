import { useEffect, useMemo, useState } from 'react'
import {
  markAvenaPMDisconnected,
  refreshAvenaPMStatus,
  useAvenaPMConnection
} from '../task-page/avenapm/avenapm-connection-store'
import { matchesAvenaPMTaskSearch, sortAvenaPMTasks } from '../task-page/avenapm/avenapm-task-view'
import type { AvenaPMTask } from '../../../../shared/avenapm/avenapm-types'
import type { SmartNameMode } from '../../../../shared/new-workspace/smart-workspace-source-results'
import type { NormalizedWorkItemSourceSearchProps } from './smart-workspace-name-field-model'

const TICKET_ID_PATTERN = /^[a-z]+-?\d+$/i

function normalizeTicketId(value: string): string {
  return value.replace(/-/g, '').toLowerCase()
}

/** Smart mode only surfaces a ticket when the query is its ID; titles would flood other sources. */
export function getAvenaPMComposerTasks(
  tasks: readonly AvenaPMTask[],
  mode: SmartNameMode,
  query: string
): AvenaPMTask[] {
  const trimmed = query.trim()
  if (mode === 'avenapm') {
    return tasks.filter((task) => matchesAvenaPMTaskSearch(task, trimmed))
  }
  if (mode !== 'smart' || !TICKET_ID_PATTERN.test(trimmed)) {
    return []
  }
  const id = normalizeTicketId(trimmed)
  return tasks.filter((task) => task.shortId && normalizeTicketId(task.shortId) === id)
}

export function useAvenaPMComposerSource(
  props: Pick<NormalizedWorkItemSourceSearchProps, 'avenapmEnabled' | 'disabled' | 'textOnly'>,
  mode: SmartNameMode
): { avenapmConnected: boolean; avenapmTasks: AvenaPMTask[]; avenapmLoading: boolean } {
  const enabled = props.avenapmEnabled !== false && !props.disabled && !props.textOnly
  const { status } = useAvenaPMConnection()
  const connected = status?.connected === true
  const [tasks, setTasks] = useState<AvenaPMTask[] | null>(null)

  useEffect(() => {
    if (enabled && status === null) {
      void refreshAvenaPMStatus()
    }
  }, [enabled, status])

  // Why: the queue has no search endpoint, so load it once per composer and filter locally.
  const shouldLoad = enabled && connected && tasks === null
  useEffect(() => {
    if (!shouldLoad) {
      return
    }
    let cancelled = false
    void window.api.avenapm
      .listTasks()
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result.ok) {
          setTasks(sortAvenaPMTasks(result.tasks, 'triage'))
          return
        }
        if (result.reason === 'unauthorized' || result.reason === 'not_connected') {
          markAvenaPMDisconnected()
        }
        setTasks([])
      })
      .catch(() => {
        if (!cancelled) {
          setTasks([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [shouldLoad])

  const loading = shouldLoad && mode === 'avenapm'
  return useMemo(
    () => ({
      avenapmConnected: enabled && connected,
      avenapmTasks: tasks ?? [],
      avenapmLoading: loading
    }),
    [connected, enabled, loading, tasks]
  )
}
