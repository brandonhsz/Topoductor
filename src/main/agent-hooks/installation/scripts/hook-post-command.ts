import type { AgentHookSource } from '../../../../shared/agent-hook-listener/transport/agent-hook-relay'
import { TOPO_HOOK_RAW_JSON_TRANSPORT } from '../../../../shared/agent-hook-listener/configuration/agent-hook-types'
import { AGENT_HOOK_METADATA_CACHE_DIR } from '../../../../shared/agent-hook-listener/transport/agent-hook-spool'

// Older curl needs C numeric parsing; keep the parent script's UTF-8 locale unchanged.
export function posixCurlCommand(curlCommand = 'curl'): string {
  return `LC_ALL= LC_NUMERIC=C ${curlCommand}`
}

const PACK_HOOK_METADATA = `printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$TOPO_PANE_KEY" "$TOPO_TAB_ID" "$TOPO_AGENT_LAUNCH_TOKEN" "$TOPO_WORKTREE_ID" "$TOPO_AGENT_HOOK_ENV" "$TOPO_AGENT_HOOK_VERSION" | base64 | tr -d '\\n'`

/** Defines `topo_hook_pack_metadata`, which reuses a pane's packed header while every input matches. */
export function buildPosixHookMetadataCacheLines(): string[] {
  return [
    'topo_hook_pack_metadata() {',
    // Length prefixes keep different inputs from forming the same key.
    '  topo_hook_meta_key="${#TOPO_PANE_KEY}:$TOPO_PANE_KEY ${#TOPO_TAB_ID}:$TOPO_TAB_ID ${#TOPO_AGENT_LAUNCH_TOKEN}:$TOPO_AGENT_LAUNCH_TOKEN ${#TOPO_WORKTREE_ID}:$TOPO_WORKTREE_ID ${#TOPO_AGENT_HOOK_ENV}:$TOPO_AGENT_HOOK_ENV ${#TOPO_AGENT_HOOK_VERSION}:$TOPO_AGENT_HOOK_VERSION"',
    '  topo_hook_meta_file=',
    // A stale variable must not create state for an absent Topo installation.
    '  if [ -r "${TOPO_AGENT_HOOK_ENDPOINT:-}" ]; then',
    '    topo_hook_meta_id=$TOPO_PANE_KEY',
    // Name it like the spool file, which may sit on a Windows drive under WSL.
    '    while :; do case "$topo_hook_meta_id" in *[/:]*) topo_hook_meta_id="${topo_hook_meta_id%%[/:]*}_${topo_hook_meta_id#*[/:]}" ;; *) break ;; esac; done',
    `    topo_hook_meta_file="\${TOPO_AGENT_HOOK_ENDPOINT%/*}/${AGENT_HOOK_METADATA_CACHE_DIR}/pane-$topo_hook_meta_id"`,
    '    topo_hook_meta_line=',
    '    IFS= read -r topo_hook_meta_line 2>/dev/null < "$topo_hook_meta_file"',
    '    topo_hook_metadata=${topo_hook_meta_line%% *}',
    '    [ -z "$topo_hook_metadata" ] || [ "${topo_hook_meta_line#* }" != "$topo_hook_meta_key" ] || return 0',
    '  fi',
    `  topo_hook_metadata=$(${PACK_HOOK_METADATA}) && [ -n "$topo_hook_metadata" ] || return 1`,
    '  [ -n "$topo_hook_meta_file" ] || return 0',
    '  [ -d "${topo_hook_meta_file%/*}" ] || mkdir -m 700 "${topo_hook_meta_file%/*}" 2>/dev/null || return 0',
    // Rename so a concurrent event never reads half a line.
    `  printf '%s %s\\n' "$topo_hook_metadata" "$topo_hook_meta_key" 2>/dev/null > "$topo_hook_meta_file.$$" && mv -f "$topo_hook_meta_file.$$" "$topo_hook_meta_file" 2>/dev/null`,
    '  return 0',
    '}'
  ]
}

type PosixAgentHookPostOptions = {
  curlCommand?: string
  indent?: string
  decisionHeaderVar?: string
  /** Take the header from `buildPosixHookMetadataCacheLines` instead of packing it every event. */
  cachedMetadata?: boolean
}

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: PosixAgentHookPostOptions = {}
): string[] {
  const curlCommand = posixCurlCommand(options.curlCommand ?? 'curl')
  const indent = options.indent ?? '  '
  // Only Claude's capture sets this; the host checks the attachment itself before trusting it.
  const tmux = source === 'claude'
  // Names the decision format the script prints; absent, Topo never waits on plugins.
  const decision = options.decisionHeaderVar
    ? [`  ${indent}-H "X-Topo-Hook-Decision: \${${options.decisionHeaderVar}:-}" \\`]
    : []
  const url = `"http://127.0.0.1:\${TOPO_AGENT_HOOK_PORT}/hook/${source}"`
  const packMetadata = options.cachedMetadata
    ? ['  topo_hook_pack_metadata && \\']
    : [
        `  topo_hook_metadata=$(${PACK_HOOK_METADATA}) && \\`,
        '  [ -n "$topo_hook_metadata" ] && \\'
      ]
  return [
    `if [ "\${TOPO_AGENT_HOOK_TRANSPORT:-}" = "${TOPO_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    ...packMetadata,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-Topo-Agent-Hook-Token: \${TOPO_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-Topo-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-Topo-Agent-Hook-Meta: \${topo_hook_metadata}" \\`,
    `  ${indent}-H "X-Topo-Agent-Process: \${topo_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}-H "X-Topo-Tmux-Pane: \${topo_tmux_pane:-}" \\`] : []),
    ...decision,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-Topo-Agent-Hook-Token: \${TOPO_AGENT_HOOK_TOKEN}" \\`,
    ...decision,
    `  ${indent}--data-urlencode "paneKey=\${TOPO_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${TOPO_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${TOPO_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${TOPO_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${TOPO_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${TOPO_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "agentProcess=\${topo_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}--data-urlencode "tmuxPane=\${topo_tmux_pane:-}" \\`] : []),
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
