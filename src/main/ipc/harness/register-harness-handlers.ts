import { BrowserWindow, ipcMain } from 'electron'
import type { HarnessDecisionAnswer } from '../../../shared/harness/harness-run-types'
import { asRecord } from '../../../shared/workspace-setup/setup-script-import-parsers'
import { createHarnessAgentLauncher } from '../../harness/harness-agent-launcher'
import {
  deleteHarnessFlow,
  listHarnessFlows,
  saveHarnessFlow
} from '../../harness/harness-flow-store'
import { HarnessRunService } from '../../harness/harness-run-service'
import type { TopoRuntimeService } from '../../runtime/topo-runtime'

const MAX_ID = 256
const MAX_TEXT = 256 * 1024

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ID) {
    throw new Error('Invalid id')
  }
  return value
}

function textRecord(value: unknown): Record<string, string> {
  const record = asRecord(value) ?? {}
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 50)
      .flatMap(([key, entry]) =>
        typeof entry === 'string' && key.length <= MAX_ID ? [[key, entry.slice(0, MAX_TEXT)]] : []
      )
  )
}

function decisionAnswer(value: unknown): HarnessDecisionAnswer {
  const record = asRecord(value)
  return {
    decisionId: id(record?.decisionId),
    choice: typeof record?.choice === 'string' ? record.choice.slice(0, MAX_ID) : null,
    text: typeof record?.text === 'string' ? record.text.slice(0, MAX_TEXT) : '',
    fields: textRecord(record?.fields)
  }
}

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

let registered = false

/** Idempotent: macOS can attach a replacement window to the same app. */
export function registerHarnessHandlers(runtime: TopoRuntimeService): void {
  if (registered) {
    return
  }
  registered = true
  const runs = new HarnessRunService(createHarnessAgentLauncher(runtime), (run) =>
    broadcast('harness:runChanged', run)
  )
  ipcMain.handle('harness:listFlows', (_event, repoId: unknown) =>
    listHarnessFlows(typeof repoId === 'string' && repoId ? repoId : null)
  )
  ipcMain.handle('harness:saveFlow', async (_event, flow: unknown) => {
    const saved = await saveHarnessFlow(flow)
    broadcast('harness:flowsChanged')
    return saved
  })
  ipcMain.handle('harness:deleteFlow', async (_event, flowId: unknown) => {
    await deleteHarnessFlow(id(flowId))
    broadcast('harness:flowsChanged')
  })
  ipcMain.handle('harness:listRuns', () => runs.list())
  ipcMain.handle('harness:getRun', (_event, runId: unknown) => runs.get(id(runId)))
  ipcMain.handle('harness:startRun', (_event, request: unknown) => {
    const record = asRecord(request)
    return runs.start({
      flowId: id(record?.flowId),
      worktreeId: id(record?.worktreeId),
      fields: textRecord(record?.fields)
    })
  })
  ipcMain.handle('harness:answerDecision', (_event, runId: unknown, answer: unknown) => {
    runs.answer(id(runId), decisionAnswer(answer))
  })
  ipcMain.handle('harness:stopRun', (_event, runId: unknown) => runs.stop(id(runId)))
  ipcMain.handle('harness:deleteRun', (_event, runId: unknown) => runs.delete(id(runId)))
}
