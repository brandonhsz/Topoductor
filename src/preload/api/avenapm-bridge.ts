import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const avenapmApi = {
  status: () => ipcRenderer.invoke('avenapm:status'),
  connect: () => ipcRenderer.invoke('avenapm:connect'),
  cancelConnect: () => ipcRenderer.invoke('avenapm:cancelConnect'),
  disconnect: () => ipcRenderer.invoke('avenapm:disconnect'),
  listTasks: (args) => ipcRenderer.invoke('avenapm:listTasks', args)
} satisfies PreloadApi['avenapm']
