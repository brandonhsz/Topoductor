import type { RuntimeNotifier } from './runtime-notifier-contract'
import { TopoRuntimeWithPtyController } from '../../terminal/lifecycle/topo-runtime-pty-controller'

export abstract class RuntimeNotifierBinding extends TopoRuntimeWithPtyController {
  setNotifier(notifier: RuntimeNotifier | null): void {
    this.notifier = notifier
    if (notifier) {
      this.repositoryForkBackfill.start()
    }
  }

  protected countTerminalSideEffectConsumingClientEventListeners(): number {
    return this.clientEvents.countTerminalSideEffectConsumers()
  }
}
