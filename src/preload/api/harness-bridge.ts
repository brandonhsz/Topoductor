import { ipcRenderer } from 'electron'
import type { HarnessFlowChange } from '../../shared/harness/harness-flow-version-types'
import type { HarnessRunSummary } from '../../shared/harness/harness-run-types'
import type { PreloadApi } from '../api-types'

export const harnessApi = {
  listFlows: (repoId) => ipcRenderer.invoke('harness:listFlows', repoId),
  saveFlow: (flow) => ipcRenderer.invoke('harness:saveFlow', flow),
  deleteFlow: (flowId) => ipcRenderer.invoke('harness:deleteFlow', flowId),
  listFlowVersions: (flowId) => ipcRenderer.invoke('harness:listFlowVersions', flowId),
  getFlowVersion: (flowId, versionId) =>
    ipcRenderer.invoke('harness:getFlowVersion', flowId, versionId),
  saveFlowVersion: (flowId, summary) =>
    ipcRenderer.invoke('harness:saveFlowVersion', flowId, summary),
  restoreFlowVersion: (flowId, versionId) =>
    ipcRenderer.invoke('harness:restoreFlowVersion', flowId, versionId),
  listRuns: () => ipcRenderer.invoke('harness:listRuns'),
  getRun: (runId) => ipcRenderer.invoke('harness:getRun', runId),
  startRun: (request) => ipcRenderer.invoke('harness:startRun', request),
  answerDecision: (runId, answer) => ipcRenderer.invoke('harness:answerDecision', runId, answer),
  stopRun: (runId) => ipcRenderer.invoke('harness:stopRun', runId),
  deleteRun: (runId) => ipcRenderer.invoke('harness:deleteRun', runId),
  onFlowsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, change?: HarnessFlowChange): void =>
      callback(change ?? null)
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
