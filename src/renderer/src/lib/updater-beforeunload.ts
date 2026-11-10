import {
  TOPO_APP_RESTART_ABORTED_EVENT,
  TOPO_APP_RESTART_STARTED_EVENT,
  TOPO_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  TOPO_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'
import { TOPO_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT } from '../../../shared/renderer-shutdown-events'

let intentionalAppRestartInProgress = false

export function isUpdaterQuitAndInstallInProgress(): boolean {
  return isIntentionalAppRestartInProgress()
}

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(TOPO_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
  window.addEventListener(TOPO_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
  window.addEventListener(TOPO_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(TOPO_APP_RESTART_ABORTED_EVENT, clearInProgress)
  window.addEventListener(TOPO_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(TOPO_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
    window.removeEventListener(TOPO_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(TOPO_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(TOPO_APP_RESTART_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(TOPO_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)
    // HMR can re-register listeners; cleanup must reset the flag so failed restarts cannot suppress later unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
