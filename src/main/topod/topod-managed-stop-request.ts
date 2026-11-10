import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import {
  TOPOD_MANAGED_STOP_REQUEST_MAX_BYTES,
  TOPOD_MANAGED_STOP_REQUEST_PREFIX,
  TopodManagedStopRequestSchema,
  type TopodManagedStopContext,
  type TopodManagedStopInstance,
  type TopodManagedStopRequest
} from '../../shared/topod-stop-request'
import { readTopodInstanceLockRecord, type TopodLockRecord } from './topod-instance-lock'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function topodManagedStopRequestPath(instance: TopodManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${TOPOD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readTopodManagedStopRequest(path: string): TopodManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('topod_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, TOPOD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return TopodManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameTopodManagedStopInstance(
  left: TopodManagedStopInstance,
  right: Pick<TopodManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function topodInstanceLockNames(instance: TopodManagedStopInstance): boolean {
  return readTopodInstanceLockNaming(instance) !== null
}

export function readTopodInstanceLockNaming(
  instance: TopodManagedStopInstance
): TopodLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readTopodInstanceLockRecord(instance.lockPath)
  return record !== null && sameTopodManagedStopInstance(instance, record) ? record : null
}

export function validateTopodManagedStopRequest(
  context: TopodManagedStopContext,
  requestPath: string
): TopodManagedStopRequest {
  const request = readTopodManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameTopodManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('topod_managed_stop_request_identity_mismatch')
  }
  if (!topodInstanceLockNames(context.instance)) {
    throw new Error('topod_managed_stop_instance_lock_changed')
  }
  return request
}
