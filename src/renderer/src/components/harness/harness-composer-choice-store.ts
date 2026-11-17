import { useSyncExternalStore } from 'react'
import type { HarnessComposerChoice } from './harness-composer-start'

let choice: HarnessComposerChoice | null = null
const listeners = new Set<() => void>()

/** The flow picked in the open Create worktree composer; the create submit reads it once. */
export function setHarnessComposerChoice(next: HarnessComposerChoice | null): void {
  choice = next
  for (const listener of listeners) {
    listener()
  }
}

export function getHarnessComposerChoice(): HarnessComposerChoice | null {
  return choice
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHarnessComposerChoice(): HarnessComposerChoice | null {
  return useSyncExternalStore(subscribe, getHarnessComposerChoice)
}
