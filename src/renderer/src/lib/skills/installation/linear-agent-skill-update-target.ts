import type { DiscoveredSkill } from '../../../../../shared/skills'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  hasInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import {
  LINEAR_TICKETS_SKILL_NAME,
  TOPO_LINEAR_SKILL_NAME
} from '@/lib/skills/installation/agent-feature-skill-names'

export type LinearAgentSkillUpdateTarget = {
  skillName: typeof TOPO_LINEAR_SKILL_NAME | typeof LINEAR_TICKETS_SKILL_NAME
}

// Use the installed legacy name only for legacy-only installs; canonical/fresh/both use the canonical skill.
export function getLinearAgentSkillUpdateTarget(
  skills: readonly DiscoveredSkill[],
  installed: boolean
): LinearAgentSkillUpdateTarget {
  const canonicalSkillInstalled = hasInstalledAgentSkill(skills, TOPO_LINEAR_SKILL_NAME, {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const legacySkillInstalled = hasInstalledAgentSkill(skills, LINEAR_TICKETS_SKILL_NAME, {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const skillName =
    !installed || canonicalSkillInstalled || !legacySkillInstalled
      ? TOPO_LINEAR_SKILL_NAME
      : LINEAR_TICKETS_SKILL_NAME
  return { skillName }
}
