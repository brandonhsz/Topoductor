import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type {
  RemoteDesktopSessionClosed,
  RemoteDesktopSessionData
} from '../../shared/remote-desktop/remote-desktop-contract'

export const remoteDesktopApi = {
  openWindow: (hostId, title) => ipcRenderer.invoke('remoteDesktop:openWindow', { hostId, title }),
  getCredentialStatus: (hostId) =>
    ipcRenderer.invoke('remoteDesktop:getCredentialStatus', { hostId }),
  saveCredential: (hostId, input) =>
    ipcRenderer.invoke('remoteDesktop:saveCredential', { hostId, input }),
  forgetCredential: (hostId) => ipcRenderer.invoke('remoteDesktop:forgetCredential', { hostId }),
  openSession: (hostId) => ipcRenderer.invoke('remoteDesktop:openSession', { hostId }),
  getSessionCredential: (sessionId) =>
    ipcRenderer.invoke('remoteDesktop:getSessionCredential', { sessionId }),
  write: (sessionId, bytes) => ipcRenderer.send('remoteDesktop:write', { sessionId, bytes }),
  closeSession: (sessionId) => ipcRenderer.invoke('remoteDesktop:closeSession', { sessionId }),
  onData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: RemoteDesktopSessionData): void =>
      callback(data)
    ipcRenderer.on('remoteDesktop:data', listener)
    return () => ipcRenderer.removeListener('remoteDesktop:data', listener)
  },
  onSessionClosed: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: RemoteDesktopSessionClosed): void =>
      callback(data)
    ipcRenderer.on('remoteDesktop:sessionClosed', listener)
    return () => ipcRenderer.removeListener('remoteDesktop:sessionClosed', listener)
  }
} satisfies PreloadApi['remoteDesktop']
