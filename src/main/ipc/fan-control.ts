import { BrowserWindow, ipcMain } from 'electron'
import {
  FAN_CONTROL_CHANNELS,
  FAN_CONTROL_MODES,
  FAN_FEEDBACK_ANSWERS,
  TEMPERATURE_SOURCES,
  type FanControlMode,
  type FanControlSetResult,
  type FanCurve,
  type FanCurvePoint,
  type FanFeedbackReply
} from '../../shared/fan-control-contract'
import type { FanControlService } from '../power/fan-control-service'

// Shape checks only: ordering, ranges and RPM limits are the service's invalid-curve/invalid-rpm errors.
function isFanControlMode(value: unknown): value is FanControlMode {
  return FAN_CONTROL_MODES.some((mode) => mode === value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCurvePoint(value: unknown): value is FanCurvePoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tempC' in value &&
    isFiniteNumber(value.tempC) &&
    'percent' in value &&
    isFiniteNumber(value.percent)
  )
}

function isFanCurve(value: unknown): value is FanCurve {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'source' in value &&
    TEMPERATURE_SOURCES.some((source) => source === value.source) &&
    'points' in value &&
    Array.isArray(value.points) &&
    value.points.every(isCurvePoint)
  )
}

function isFeedbackReply(value: unknown): value is FanFeedbackReply {
  return value === 'never' || FAN_FEEDBACK_ANSWERS.some((answer) => answer === value)
}

export function registerFanControlHandlers(service: FanControlService): void {
  ipcMain.handle(FAN_CONTROL_CHANNELS.getStatus, () => service.getStatus())
  ipcMain.handle(FAN_CONTROL_CHANNELS.getHistory, () => service.getHistory())
  ipcMain.handle(
    FAN_CONTROL_CHANNELS.setMode,
    async (_event, mode: unknown): Promise<FanControlSetResult> => {
      if (!isFanControlMode(mode)) {
        throw new Error(`Invalid fan control mode: ${String(mode)}`)
      }
      return service.setMode(mode)
    }
  )
  ipcMain.handle(
    FAN_CONTROL_CHANNELS.setCurve,
    async (_event, curve: unknown): Promise<FanControlSetResult> => {
      if (!isFanCurve(curve)) {
        throw new Error('Invalid fan curve')
      }
      return service.setCurve(curve)
    }
  )
  ipcMain.handle(
    FAN_CONTROL_CHANNELS.setManualRpm,
    async (_event, index: unknown, rpm: unknown): Promise<FanControlSetResult> => {
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid fan index: ${String(index)}`)
      }
      if (!isFiniteNumber(rpm)) {
        throw new Error(`Invalid fan rpm: ${String(rpm)}`)
      }
      return service.setManualRpm(index, rpm)
    }
  )
  ipcMain.handle(
    FAN_CONTROL_CHANNELS.answerFeedback,
    async (_event, promptId: unknown, reply: unknown): Promise<FanControlSetResult> => {
      if (typeof promptId !== 'string' || promptId.length === 0) {
        throw new Error('Invalid feedback prompt id')
      }
      if (!isFeedbackReply(reply)) {
        throw new Error(`Invalid feedback reply: ${String(reply)}`)
      }
      return service.answerFeedback(promptId, reply)
    }
  )
  ipcMain.handle(FAN_CONTROL_CHANNELS.resetSmartProfile, () => service.resetSmartProfile())
  ipcMain.handle(FAN_CONTROL_CHANNELS.dismissPausedMode, () => service.dismissPausedMode())
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
