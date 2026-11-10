import type { TopoRuntimeService } from '../runtime/topo-runtime'
import type { TopodRuntimeCleanup } from './topod-runtime-lifetime'
import { EmulatorBridge } from '../emulator/emulator-bridge'
import { withTimeout } from '../../shared/promise-timeout-fallback'

// A stalled adb must not hold the final profile flush past topod's shutdown deadline.
const EMULATOR_TEARDOWN_BUDGET_MS = 3_000

/** Android drives adb/emulator on any host; iOS backends report their own host-support errors. */
export function installTopodEmulatorBridge(
  runtime: TopoRuntimeService,
  registerCleanup: (cleanup: TopodRuntimeCleanup) => void
): void {
  const bridge = new EmulatorBridge()
  runtime.setEmulatorBridge(bridge)
  // Like desktop quit: stop the helpers and devices Topo started.
  registerCleanup(() =>
    withTimeout(bridge.destroyAllSessions(), EMULATOR_TEARDOWN_BUDGET_MS, undefined)
  )
}
