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
  // Track viewers per renderer so a closed window cannot leave polling on forever.
  const monitoringViewers = new Set<number>()

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
  ipcMain.on(FAN_CONTROL_CHANNELS.setMonitoring, (event, active: unknown) => {
    if (typeof active !== 'boolean') {
      return
    }
    const sender = event.sender
    const id = sender.id
    if (active && !monitoringViewers.has(id)) {
      monitoringViewers.add(id)
      sender.once('destroyed', () => {
        monitoringViewers.delete(id)
        service.setMonitoring(monitoringViewers.size > 0)
      })
    } else if (!active) {
      monitoringViewers.delete(id)
    }
    service.setMonitoring(monitoringViewers.size > 0)
  })

  service.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(FAN_CONTROL_CHANNELS.changed, status)
      }
    }
  })
}
