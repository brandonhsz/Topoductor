import type { TopoRuntimeService } from '../topo-runtime'

export const availableRevealWorkspace: TopoRuntimeService['prepareStructuredAgentSessionRevealWorkspace'] =
  async () => ({
    current: () => true,
    check: () => {},
    release: Object.assign(() => {}, { isCurrent: () => true })
  })
