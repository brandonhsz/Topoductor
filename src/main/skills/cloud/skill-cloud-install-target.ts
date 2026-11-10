import type { SkillInstallDestination } from '../../../shared/skill-install-contract'
import type { TopoRuntimeService } from '../../runtime/topo-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: TopoRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
