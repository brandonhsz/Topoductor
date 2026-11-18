import { BrowserWindow, ipcMain } from 'electron'
import {
  FAN_CONTROL_CHANNELS,
  type FanControlMode,
  type FanControlSetResult
} from '../../shared/fan-control-contract'
import type { FanControlService } from '../power/fan-control-service'

function isFanControlMode(value: unknown): value is FanControlMode {
  return value === 'auto' || value === 'max'
}

export function registerFanControlHandlers(service: FanControlService): void {
  ipcMain.handle(FAN_CONTROL_CHANNELS.getStatus, () => service.getStatus())
  ipcMain.handle(
    FAN_CONTROL_CHANNELS.setMode,
    async (_event, mode: unknown): Promise<FanControlSetResult> => {
      if (!isFanControlMode(mode)) {
        throw new Error(`Invalid fan control mode: ${String(mode)}`)
      }
      return service.setMode(mode)
    }
  )
  ipcMain.on(FAN_CONTROL_CHANNELS.setMonitoring, (_event, active: unknown) => {
    if (typeof active === 'boolean') {
      service.setMonitoring(active)
    }
  })

  service.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(FAN_CONTROL_CHANNELS.changed, status)
      }
    }
  })
}
