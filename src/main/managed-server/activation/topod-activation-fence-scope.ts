// Resumed stale holders must prove their generation on-host before every step, preventing writes or release under a successor's fence.
import { AsyncLocalStorage } from 'node:async_hooks'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'

export const TOPOD_FENCE_OWNER_FILENAME = '.topo-fence-owner'
export const TOPOD_FENCE_LOST_MARKER = '__TOPOD_FENCE_LOST__'
/** EX_TEMPFAIL: this superseded generation cannot retry its step. */
export const TOPOD_FENCE_LOST_EXIT = 75

export type TopodFence = { lockDir: string; token: string }

const scope = new AsyncLocalStorage<TopodFence>()

export function runWithTopodFence<T>(fence: TopodFence, run: () => Promise<T>): Promise<T> {
  return scope.run(fence, run)
}

export function currentTopodFence(): TopodFence | null {
  return scope.getStore() ?? null
}

export class TopodFenceLostError extends Error {
  constructor() {
    super(
      "This run's activation fence was taken over by another run, so it stopped before changing the host."
    )
    this.name = 'TopodFenceLostError'
  }
}

export function posixTopodFenceOwnedTest(fence: TopodFence): string {
  const owner = quotePosixShell(
    `${fence.lockDir.replace(/\/+$/u, '')}/${TOPOD_FENCE_OWNER_FILENAME}`
  )
  return `[ "$(cat ${owner} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]`
}

export function posixTopodFenceGuard(fence: TopodFence): string {
  return `${posixTopodFenceOwnedTest(fence)} || { echo ${TOPOD_FENCE_LOST_MARKER}; exit ${TOPOD_FENCE_LOST_EXIT}; };`
}

/** Use exit status and stdout; error messages quote commands containing the marker even when no guard failed. */
export function isTopodFenceLost(error: unknown): boolean {
  if (!isSshCommandExitError(error)) {
    return false
  }
  // `powershell -Command` reports any nonzero native exit as 1.
  const exited = error.exitCode === TOPOD_FENCE_LOST_EXIT || error.exitCode === 1
  return exited && error.stdout.trim().split(/\r?\n/u).at(-1) === TOPOD_FENCE_LOST_MARKER
}
