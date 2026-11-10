/** Hide transaction siblings from discovery to avoid duplicate rows and repeat deletes. Match the shared .*.topo-* shape so native checks and WSL find-prune agree. */
export const SKILL_DELETE_STAGING_MARKER = '.topo-skill-delete-'

export function skillDeleteStagedName(basename: string, id: string): string {
  return `.${basename}${SKILL_DELETE_STAGING_MARKER}${id}`
}

export function isSkillDeleteStagedName(basename: string, staged: string): boolean {
  return staged.startsWith(`.${basename}${SKILL_DELETE_STAGING_MARKER}`)
}
