import type { PreloadApi } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'

function desktopOnly(): Promise<never> {
  return Promise.reject(
    new Error(
      translate(
        'components.harness.webUnavailable',
        'Harness flows run in the desktop app, where the agents run.'
      )
    )
  )
}

// Flows and runs live in the desktop's user data; the web client has no access to them yet.
export function createWebHarnessApi(): PreloadApi['harness'] {
  return {
    listFlows: () => Promise.resolve([]),
    saveFlow: desktopOnly,
    deleteFlow: desktopOnly,
    listFlowVersions: () => Promise.resolve([]),
    getFlowVersion: () => Promise.resolve(null),
    saveFlowVersion: desktopOnly,
    restoreFlowVersion: desktopOnly,
    listRuns: () => Promise.resolve([]),
    getRun: () => Promise.resolve(null),
    startRun: desktopOnly,
    answerDecision: desktopOnly,
    stopRun: desktopOnly,
    deleteRun: desktopOnly,
    onFlowsChanged: () => () => {},
    onRunChanged: () => () => {}
  }
}
