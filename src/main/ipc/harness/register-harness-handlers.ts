import { BrowserWindow, ipcMain } from 'electron'
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import { isTuiAgent } from '../../../shared/harness/harness-flow-normalize'
import type { HarnessDecisionAnswer } from '../../../shared/harness/harness-run-types'
import { asRecord } from '../../../shared/workspace-setup/setup-script-import-parsers'
import {
  closeHarnessTablessSession,
  createHarnessAgentLauncher
} from '../../harness/harness-agent-launcher'
import {
  deleteHarnessFlow,
  getHarnessFlow,
  listHarnessFlows,
  onHarnessFlowsChanged,
  restoreHarnessFlowVersion,
  saveHarnessFlow
} from '../../harness/harness-flow-store'
import {
  getHarnessFlowVersion,
  listHarnessFlowVersions,
  recordHarnessFlowVersion
} from '../../harness/harness-flow-version-store'
import { HarnessRunService } from '../../harness/harness-run-service'
import { setHarnessRunService } from '../../harness/harness-run-registry'
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

/** Terminal chats (`terminal:<pane>`) have no conversation record, so their steps keep Topo's own agents. */
async function harnessChatProvider(
  runtime: TopoRuntimeService,
  chatSessionId: string | null
): Promise<TuiAgent | null> {
  if (!chatSessionId || chatSessionId.startsWith('terminal:')) {
    return null
  }
  try {
    const store = await runtime.openAgentSessionRecordStore()
    const provider = store.getConversation(chatSessionId)?.provider
    return provider && isTuiAgent(provider) ? provider : null
  } catch {
    return null
  }
}

let registered = false

/** Idempotent: macOS can attach a replacement window to the same app. */
export function registerHarnessHandlers(runtime: TopoRuntimeService): void {
  if (registered) {
    return
  }
  registered = true
  const runs = new HarnessRunService(
    createHarnessAgentLauncher(runtime),
    (run) => broadcast('harness:runChanged', run),
    (run) => harnessChatProvider(runtime, run.chatSessionId),
    closeHarnessTablessSession
  )
  setHarnessRunService(runs)
  ipcMain.handle('harness:listFlows', (_event, repoId: unknown) =>
    listHarnessFlows(typeof repoId === 'string' && repoId ? repoId : null)
  )
  // The store is the only source of change events, so agent edits over RPC reach the editor too.
  onHarnessFlowsChanged((change) => broadcast('harness:flowsChanged', change))
  ipcMain.handle('harness:saveFlow', (_event, flow: unknown) => saveHarnessFlow(flow))
  ipcMain.handle('harness:deleteFlow', (_event, flowId: unknown) => deleteHarnessFlow(id(flowId)))
  ipcMain.handle('harness:listFlowVersions', (_event, flowId: unknown) =>
    listHarnessFlowVersions(id(flowId))
  )
  ipcMain.handle('harness:getFlowVersion', (_event, flowId: unknown, versionId: unknown) =>
    getHarnessFlowVersion(id(flowId), id(versionId))
  )
  ipcMain.handle('harness:saveFlowVersion', async (_event, flowId: unknown, summary: unknown) => {
    const flow = await getHarnessFlow(id(flowId))
    if (!flow) {
      throw new Error(`harness_flow_not_found: ${String(flowId)}`)
    }
    return recordHarnessFlowVersion({
      flow,
      author: 'person',
      summary: typeof summary === 'string' ? summary : ''
    })
  })
  ipcMain.handle('harness:restoreFlowVersion', (_event, flowId: unknown, versionId: unknown) =>
    restoreHarnessFlowVersion(id(flowId), id(versionId))
  )
  ipcMain.handle('harness:listRuns', () => runs.list())
  ipcMain.handle('harness:getRun', (_event, runId: unknown) => runs.get(id(runId)))
  ipcMain.handle('harness:startRun', (_event, request: unknown) => {
    const record = asRecord(request)
    return runs.start({
      flowId: id(record?.flowId),
      worktreeId: id(record?.worktreeId),
      fields: textRecord(record?.fields),
      mode: record?.mode === 'chat' ? 'chat' : 'orchestrated',
      chatSessionId:
        typeof record?.chatSessionId === 'string' && record.chatSessionId
          ? id(record.chatSessionId)
          : null
    })
  })
  ipcMain.handle('harness:answerDecision', (_event, runId: unknown, answer: unknown) => {
    runs.answer(id(runId), decisionAnswer(answer))
  })
  ipcMain.handle('harness:stopRun', (_event, runId: unknown) => runs.stop(id(runId)))
  ipcMain.handle('harness:deleteRun', (_event, runId: unknown) => runs.delete(id(runId)))
}
