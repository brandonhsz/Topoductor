import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const topoMcpApi = {
  secretStatus: (keys) => ipcRenderer.invoke('topoMcp:secretStatus', keys),
  setSecret: (key, value) => ipcRenderer.invoke('topoMcp:setSecret', key, value),
  deleteSecret: (key) => ipcRenderer.invoke('topoMcp:deleteSecret', key)
} satisfies PreloadApi['topoMcp']
