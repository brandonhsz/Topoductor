import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { FanControlApi } from '../../../../../shared/fan-control-contract'
import type { PreloadApi } from '../../../../../preload/api-types'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../ui/button'
import { SettingsRow, SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { getGeneralFanSearchEntries } from './general-fan-search'

type FanSmartModeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function fanControlBridge(): FanControlApi | undefined {
  // Paired web clients expose a partial bridge without fan control.
  const api: Partial<PreloadApi> | undefined = window.api
  return api?.fanControl
}

export function FanSmartModeSetting({
  settings,
  updateSettings
}: FanSmartModeSettingProps): React.JSX.Element | null {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const mounted = useMountedRef()
  const [supported, setSupported] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    const api = fanControlBridge()
    if (!api) {
      return
    }
    let active = true
    void api
      .getStatus()
      .then((status) => {
        if (active) {
          setSupported(status.supported)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const api = fanControlBridge()
  if (!api || !supported) {
    return null
  }

  const [questionsEntry, resetEntry] = getGeneralFanSearchEntries()
  const askEnabled = settings.fanSmartFeedbackPrompts

  async function resetLearning(bridge: FanControlApi): Promise<void> {
    const accepted = await confirm({
      title: t('settings.fanSmart.resetConfirmTitle', 'Reset Smart fan learning?'),
      description: t(
        'settings.fanSmart.resetConfirmDescription',
        'Topo forgets every answer you gave and Smart mode goes back to its starting curve. This can’t be undone.'
      ),
      confirmLabel: t('settings.fanSmart.resetConfirm', 'Reset'),
      confirmVariant: 'destructive'
    })
    if (!accepted || !mounted.current) {
      return
    }
    setResetting(true)
    try {
      const result = await bridge.resetSmartProfile()
      if (result.ok) {
        toast.success(t('settings.fanSmart.resetDone', 'Smart fan learning reset.'))
      } else {
        toast.error(t('settings.fanSmart.resetFailed', 'Could not reset Smart fan learning.'))
      }
    } catch {
      toast.error(t('settings.fanSmart.resetFailed', 'Could not reset Smart fan learning.'))
    } finally {
      if (mounted.current) {
        setResetting(false)
      }
    }
  }

  return (
    <SettingsGroup title={t('settings.fanSmart.groupTitle', 'Fans')}>
      <SearchableSetting {...questionsEntry}>
        <SettingsSwitchRow
          label={questionsEntry.title}
          description={questionsEntry.description}
          checked={askEnabled}
          onChange={() => updateSettings({ fanSmartFeedbackPrompts: !askEnabled })}
        />
      </SearchableSetting>
      <SearchableSetting {...resetEntry}>
        <SettingsRow
          label={resetEntry.title}
          description={resetEntry.description}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={resetting}
              onClick={() => void resetLearning(api)}
            >
              {t('settings.fanSmart.resetButton', 'Reset learning')}
            </Button>
          }
        />
      </SearchableSetting>
    </SettingsGroup>
  )
}
