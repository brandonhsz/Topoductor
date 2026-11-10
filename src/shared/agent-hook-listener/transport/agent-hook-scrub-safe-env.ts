/** DSH0.1.5-rc.1 and Claude2.1.310 (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) scrub KEY/TOKEN/SECRET/PASSWORD names, including pane identity. Use scrub-safe aliases without replacing canonical names. */

/** Alias for `TOPO_PANE_KEY`. */
export const TOPO_SCRUB_SAFE_PANE_ENV = 'TOPO_AGENT_PANE' as const

/** Alias for `TOPO_AGENT_LAUNCH_TOKEN`. */
export const TOPO_SCRUB_SAFE_LAUNCH_ENV = 'TOPO_AGENT_LAUNCH' as const

const ALIASES: readonly (readonly [source: string, alias: string])[] = [
  ['TOPO_PANE_KEY', TOPO_SCRUB_SAFE_PANE_ENV],
  ['TOPO_AGENT_LAUNCH_TOKEN', TOPO_SCRUB_SAFE_LAUNCH_ENV]
]

/** Drop aliases whose source is absent so inherited parent identity cannot claim this pane's hooks. */
export function applyScrubSafeAgentEnvAliases(env: Record<string, string>): void {
  for (const [source, alias] of ALIASES) {
    const value = env[source]
    if (value === undefined || value === '') {
      delete env[alias]
      continue
    }
    env[alias] = value
  }
}

/** POSIX hook prologue: refill the canonical names from their aliases; never overwrites a live value. */
export function buildPosixScrubSafeEnvRestoreLines(): string[] {
  return [
    ...ALIASES.map(([source, alias]) => `: "\${${source}:=\${${alias}:-}}"`),
    `export ${ALIASES.map(([source]) => source).join(' ')}`
  ]
}

/** Windows `.cmd` hook prologue with the same contract. */
export function buildWindowsScrubSafeEnvRestoreLines(): string[] {
  return ALIASES.map(
    ([source, alias]) => `if not defined ${source} if defined ${alias} set "${source}=%${alias}%"`
  )
}
