import { ipcRenderer } from 'electron'
import {
  FAN_CONTROL_CHANNELS,
  type FanControlMode,
  type FanControlSetResult,
  type FanControlStatus
} from '../../shared/fan-control-contract'
import type { PreloadApi } from '../api-types'

export const fanControlApi = {
  getStatus: (): Promise<FanControlStatus> => ipcRenderer.invoke(FAN_CONTROL_CHANNELS.getStatus),
  setMode: (mode: FanControlMode): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.setMode, mode),
  setMonitoring: (active: boolean): void => {
    ipcRenderer.send(FAN_CONTROL_CHANNELS.setMonitoring, active)
  },
  onChanged: (callback: (status: FanControlStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: FanControlStatus): void =>
      callback(status)
    ipcRenderer.on(FAN_CONTROL_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(FAN_CONTROL_CHANNELS.changed, listener)
  }
} satisfies PreloadApi['fanControl']
