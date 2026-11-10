// COMPAT(wsl-bridge): removed when WSL runs as an topod host.
import { buildAgentFeatureSkillInstallCommand as buildPinnedSkillInstallCommand } from '../../../../../shared/agent-feature-install-commands'
import {
  TOPO_CLI_SKILL_NAME,
  TOPO_LINEAR_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from './agent-feature-skill-names'

/** The interactive install, pinned to this build; also the update, since `add` re-copies. */
export function buildAgentFeatureSkillInstallCommand(skillNames: readonly string[]): string {
  return buildPinnedSkillInstallCommand(skillNames, { sourceCommit: TOPO_BUILD_COMMIT })
}

export const ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCHESTRATION_SKILL_NAME
])

export const TOPO_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  TOPO_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
])

export const TOPO_LINEAR_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  TOPO_LINEAR_SKILL_NAME
])
