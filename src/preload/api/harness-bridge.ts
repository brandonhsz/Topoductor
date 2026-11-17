import { ipcRenderer } from 'electron'
import type { HarnessRunSummary } from '../../shared/harness/harness-run-types'
import type { PreloadApi } from '../api-types'

export const harnessApi = {
  listFlows: (repoId) => ipcRenderer.invoke('harness:listFlows', repoId),
  saveFlow: (flow) => ipcRenderer.invoke('harness:saveFlow', flow),
  deleteFlow: (flowId) => ipcRenderer.invoke('harness:deleteFlow', flowId),
  listRuns: () => ipcRenderer.invoke('harness:listRuns'),
  getRun: (runId) => ipcRenderer.invoke('harness:getRun', runId),
  startRun: (request) => ipcRenderer.invoke('harness:startRun', request),
  answerDecision: (runId, answer) => ipcRenderer.invoke('harness:answerDecision', runId, answer),
  stopRun: (runId) => ipcRenderer.invoke('harness:stopRun', runId),
  deleteRun: (runId) => ipcRenderer.invoke('harness:deleteRun', runId),
  onFlowsChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('harness:flowsChanged', listener)
    return () => ipcRenderer.removeListener('harness:flowsChanged', listener)
  },
  onRunChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, run: HarnessRunSummary): void =>
      callback(run)
    ipcRenderer.on('harness:runChanged', listener)
    return () => ipcRenderer.removeListener('harness:runChanged', listener)
  }
} satisfies PreloadApi['harness']
