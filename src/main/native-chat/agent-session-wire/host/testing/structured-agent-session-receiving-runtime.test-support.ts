import { TopoRuntimeService } from '../../../../runtime/topo-runtime'

export class ReceivingRuntime extends TopoRuntimeService {
  override getOrchestrationDbIfAvailable() {
    return super.getOrchestrationDbIfAvailable()
  }
  mailTarget(handle: string) {
    return this.resolveStructuredMailboxTarget(handle)
  }
}
