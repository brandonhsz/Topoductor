import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  type FanControlError
} from '../../../../shared/fan-control-contract'
import { FanControlMenuView, type SupportedFanControlStatus } from './FanControlStatusSegment'

const AUTO: SupportedFanControlStatus = {
  supported: true,
  ...NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS,
  mode: 'auto',
  pending: false,
  fans: [
    { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 },
    { index: 1, rpm: 2510, minRpm: 2317, maxRpm: 6800 }
  ]
}

const MAX: SupportedFanControlStatus = {
  ...AUTO,
  mode: 'max',
  fans: AUTO.fans.map((fan) => ({ ...fan, rpm: 6790 }))
}

function openMenu(status: SupportedFanControlStatus, notice: FanControlError | null = null) {
  return () => (
    <div className="flex h-80 items-end justify-end bg-background p-3">
      <FanControlMenuView
        status={status}
        iconOnly={false}
        notice={notice}
        defaultOpen
        onSelectMode={() => {}}
      />
    </div>
  )
}

export const automatic = defineFixture({ width: 360, render: openMenu(AUTO) })

export const maxSpeed = defineFixture({ width: 360, render: openMenu(MAX) })

export const authCancelled = defineFixture({
  width: 360,
  render: openMenu(AUTO, { kind: 'auth-cancelled' })
})

export const holdExited = defineFixture({
  width: 360,
  render: openMenu({ ...AUTO, lastError: { kind: 'hold-exited', detail: 'exit 1' } })
})
