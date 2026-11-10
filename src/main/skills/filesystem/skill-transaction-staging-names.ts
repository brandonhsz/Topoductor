/** The `find -name` glob the WSL guest script prunes on. */
export const SKILL_STAGING_GLOB = '.*.topo-*'

const SKILL_STAGING_NAME = /^\..+\.topo-/u

export function isSkillStagingEntryName(name: string): boolean {
  return SKILL_STAGING_NAME.test(name)
}
