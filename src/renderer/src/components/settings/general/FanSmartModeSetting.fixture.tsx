import { getDefaultSettings } from '../../../../../shared/constants'
import { NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS } from '../../../../../shared/fan-control-contract'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { ConfirmationDialogProvider } from '../../confirmation-dialog'
import { FanSmartModeSetting } from './FanSmartModeSetting'

const status = {
  supported: true as const,
  ...NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  mode: 'smart' as const,
  pending: false,
  fans: [{ index: 0, rpm: 2400, minRpm: 2317, maxRpm: 6800 }]
}

export const supported = defineFixture({
  width: 640,
  setup: () => {
    Object.assign(window.api, {
      fanControl: {
        getStatus: async () => status,
        resetSmartProfile: async () => ({ ok: true, status }),
        onChanged: () => () => {}
      }
    })
  },
  render: () => (
    <ConfirmationDialogProvider>
      <FanSmartModeSetting
        settings={getDefaultSettings('/home/fixture')}
        updateSettings={() => {}}
      />
    </ConfirmationDialogProvider>
  )
})
