import { ipcMain } from 'electron'
import {
  cancelAvenaPMConnect,
  connectAvenaPM,
  disconnectAvenaPM,
  getAvenaPMStatus,
  listAvenaPMTasks
} from '../../avenapm/avenapm-client'
import {
  AVENAPM_TASK_CLASSIFICATIONS,
  AVENAPM_TASK_STATUSES,
  type AvenaPMListTasksArgs
} from '../../../shared/avenapm/avenapm-types'
import { asRecord } from '../../../shared/workspace-setup/setup-script-import-parsers'

function parseListArgs(value: unknown): AvenaPMListTasksArgs {
  const raw = asRecord(value) ?? {}
  return {
    status: AVENAPM_TASK_STATUSES.find((status) => status === raw.status) ?? null,
    classification:
      AVENAPM_TASK_CLASSIFICATIONS.find(
        (classification) => classification === raw.classification
      ) ?? null,
    includeClosed: raw.includeClosed === true
  }
}

export function registerAvenaPMHandlers(): void {
  ipcMain.handle('avenapm:status', () => getAvenaPMStatus())
  ipcMain.handle('avenapm:connect', () => connectAvenaPM())
  ipcMain.handle('avenapm:cancelConnect', () => cancelAvenaPMConnect())
  ipcMain.handle('avenapm:disconnect', () => disconnectAvenaPM())
  ipcMain.handle('avenapm:listTasks', (_event, args: unknown) =>
    listAvenaPMTasks(parseListArgs(args))
  )
}
