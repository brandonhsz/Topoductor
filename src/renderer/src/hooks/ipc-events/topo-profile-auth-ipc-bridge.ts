import { useAppStore } from '../../store'

export function registerTopoProfileAuthIpcBridge(unsubs: (() => void)[]): void {
  const api = window.api.topoProfiles
  if (typeof api?.onAuthStatusChanged === 'function') {
    unsubs.push(
      api.onAuthStatusChanged(() => {
        void useAppStore.getState().fetchTopoProfileAuthStatus()
      })
    )
  }
  if (typeof api?.onSignInProgressChanged === 'function') {
    // Why: a sign-in can already be in flight when this window loads; a later event or teardown wins.
    let ignoreSnapshot = false
    const unsubscribe = api.onSignInProgressChanged((progress) => {
      ignoreSnapshot = true
      useAppStore.setState({ topoProfileSignInProgress: progress })
    })
    unsubs.push(() => {
      ignoreSnapshot = true
      unsubscribe()
    })
    void Promise.resolve()
      .then(() => api.signInProgress())
      .then((progress) => {
        if (!ignoreSnapshot) {
          useAppStore.setState({ topoProfileSignInProgress: progress ?? null })
        }
      })
      .catch(() => {})
  }
}
