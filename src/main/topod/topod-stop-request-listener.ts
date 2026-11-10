// Consume slot stop files; retain validated instance-bound requests as evidence until exit is proven.
import { unlinkSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  TOPOD_STOP_REQUEST_FILENAME,
  type TopodManagedStopContext,
  type TopodManagedStopRequest
} from '../../shared/topod-stop-request'
import {
  topodManagedStopRequestPath,
  validateTopodManagedStopRequest
} from './topod-managed-stop-request'
import { claimTopodManagedStopDecision } from './topod-managed-stop-decision'
import { withdrawTopodManagedStopRequest } from './topod-managed-stop-cancellation'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'

export type TopodStopRequestListener = { close(): void }

const DEFAULT_POLL_INTERVAL_MS = 1_000

function listenForRequest<T>(
  requestPath: string,
  consume: (path: string) => T | null,
  onRequest: (request: T) => void,
  pollIntervalMs: number
): TopodStopRequestListener {
  let closed = false
  let lastFailure: string | null = null
  const check = (): void => {
    if (closed) {
      return
    }
    let request: T | null
    try {
      request = consume(requestPath)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        const failure = error instanceof Error ? error.message : String(error)
        if (failure !== lastFailure) {
          lastFailure = failure
          console.error(`[topod] refused stop request at ${requestPath}:`, error)
        }
      }
      return
    }
    if (request === null) {
      return
    }
    closed = true
    stop()
    onRequest(request)
  }
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dirname(requestPath), (_event, changed) => {
      if (!changed || basename(String(changed)) === basename(requestPath)) {
        check()
      }
    })
    watcher.on('error', (error) => console.error('[topod] stop-request watcher failed:', error))
    watcher.unref()
  } catch (error) {
    // Polling still delivers requests when filesystem watching fails.
    console.error('[topod] stop-request watcher could not start:', error)
  }
  const poll = setInterval(check, pollIntervalMs)
  poll.unref()
  const stop = (): void => {
    watcher?.close()
    clearInterval(poll)
  }
  check()
  return {
    close: () => {
      closed = true
      stop()
    }
  }
}

export function installTopodStopRequestListeners(
  onRequest: () => void,
  options: {
    installRoot: string
    managedStop?: TopodManagedStopContext
    /** Best-effort preparation runs before shutdown and cannot prevent it. */
    beforeManagedStop?: (request: TopodManagedStopRequest) => Promise<void>
    pollIntervalMs?: number
  }
): TopodStopRequestListener {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  // Initial checks can close listeners synchronously before setup returns.
  const listeners: TopodStopRequestListener[] = []
  const close = (): void => {
    for (const listener of listeners) {
      listener.close()
    }
  }
  listeners.push(
    listenForRequest(
      join(options.installRoot, TOPOD_STOP_REQUEST_FILENAME),
      (path) => {
        unlinkSync(path)
        return true
      },
      () => onRequest(),
      pollIntervalMs
    )
  )
  const managedStop = options.managedStop
  if (managedStop) {
    const prepare = options.beforeManagedStop ?? (async () => {})
    listeners.push(
      listenForRequest(
        topodManagedStopRequestPath(managedStop.instance),
        (path) => {
          const request = validateTopodManagedStopRequest(managedStop, path)
          if (claimTopodManagedStopDecision(request, 'dispatched') === 'canceled') {
            // Withdraw canceled requests so later transactions can publish their own.
            withdrawTopodManagedStopRequest(request)
            throw new Error('topod_managed_stop_canceled')
          }
          return request
        },
        (request) => {
          close()
          void prepare(request)
            .catch((error: unknown) =>
              console.error('[topod] managed stop preparation failed:', error)
            )
            .finally(onRequest)
        },
        pollIntervalMs
      )
    )
  }
  return { close }
}
