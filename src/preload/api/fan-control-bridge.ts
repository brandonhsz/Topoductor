import { ipcRenderer } from 'electron'
import {
  FAN_CONTROL_CHANNELS,
  type FanControlMode,
  type FanControlSetResult,
  type FanControlStatus,
  type FanCurve,
  type FanFeedbackReply,
  type ThermalSample
} from '../../shared/fan-control-contract'
import type { PreloadApi } from '../api-types'

export const fanControlApi = {
  getStatus: (): Promise<FanControlStatus> => ipcRenderer.invoke(FAN_CONTROL_CHANNELS.getStatus),
  getHistory: (): Promise<ThermalSample[]> => ipcRenderer.invoke(FAN_CONTROL_CHANNELS.getHistory),
  setMode: (mode: FanControlMode): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.setMode, mode),
  setCurve: (curve: FanCurve): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.setCurve, curve),
  setManualRpm: (index: number, rpm: number): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.setManualRpm, index, rpm),
  answerFeedback: (promptId: string, reply: FanFeedbackReply): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.answerFeedback, promptId, reply),
  resetSmartProfile: (): Promise<FanControlSetResult> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.resetSmartProfile),
  dismissPausedMode: (): Promise<FanControlStatus> =>
    ipcRenderer.invoke(FAN_CONTROL_CHANNELS.dismissPausedMode),
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
