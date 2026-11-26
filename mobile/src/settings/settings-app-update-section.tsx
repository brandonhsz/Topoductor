import { useEffect, useState } from 'react'
import { appReleaseVersion } from '../app-update/app-release-version'
import {
  appUpdateChecker,
  openAppUpdate,
  useAppUpdateState
} from '../app-update/app-update-runtime'
import {
  applyOtaUpdate,
  checkForOtaUpdate,
  useOtaUpdateState
} from '../app-update/ota-update-runtime'
import { AppUpdateSettingsRows, type AppUpdateCheckRowStatus } from './app-update-settings-rows'

const CHECK_RESULT_VISIBLE_MS = 3000
const RELATIVE_TIME_TICK_MS = 60_000

export function SettingsAppUpdateSection() {
  const state = useAppUpdateState()
  const ota = useOtaUpdateState()
  const [result, setResult] = useState<'up-to-date' | 'failed' | null>(null)
  // Tick only when the relative label can age past just now.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (result === null) {
      return
    }
    const hide = setTimeout(() => setResult(null), CHECK_RESULT_VISIBLE_MS)
    return () => clearTimeout(hide)
  }, [result])

  // One tap asks both channels: the store for a new binary, the OTA server for a new JS bundle.
  const runCheck = () => {
    setResult(null)
    void Promise.all([appUpdateChecker.checkNow(), checkForOtaUpdate()]).then(
      ([store, otaPhase]) => {
        if (store === 'available' || otaPhase === 'ready') {
          setResult(null)
          return
        }
        setResult(store === 'failed' || otaPhase === 'failed' ? 'failed' : 'up-to-date')
      }
    )
  }

  const checkStatus: AppUpdateCheckRowStatus =
    ota.phase === 'downloading'
      ? 'downloading'
      : state.checking || ota.phase === 'checking'
        ? 'checking'
        : (result ?? 'idle')
  return (
    <AppUpdateSettingsRows
      installedVersion={appReleaseVersion}
      available={state.available}
      lastCheckedAt={state.lastCheckedAt}
      now={now}
      checkStatus={checkStatus}
      onUpdate={openAppUpdate}
      onCheck={runCheck}
      otaReady={ota.phase === 'ready'}
      onApplyOta={applyOtaUpdate}
    />
  )
}
