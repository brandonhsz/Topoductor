/** Capture before Topo inserts its managed-script shell. */
export const HOOK_PARENT_CAPTURE = 'TOPO_HOOK_AGENT_PID="${PPID:-}"; export TOPO_HOOK_AGENT_PID; '

// Uncached, as no builtin tells a reused PID from its old process: Linux reads /proc, macOS runs only ps.
export function buildHookProcessCapture(): string[] {
  return [
    'topo_agent_process=',
    // Field 20 after the command name is the start time in clock ticks since boot.
    'topo_agent_start_ticks() { topo_agent_start=${20-}; }',
    '[ -z "${TOPO_PANE_KEY:-}" ] || case "${TOPO_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$TOPO_HOOK_AGENT_PID/stat" ]; then',
    '    topo_agent_stat= topo_agent_line= topo_agent_boot= topo_agent_start=',
    // Read to EOF: a command name may contain a newline, and the strip below takes the last ") ".
    '    while IFS= read -r topo_agent_line || [ -n "$topo_agent_line" ]; do topo_agent_stat="$topo_agent_stat$topo_agent_line "; topo_agent_line=; done 2>/dev/null < "/proc/$TOPO_HOOK_AGENT_PID/stat"',
    '    IFS= read -r topo_agent_boot 2>/dev/null < /proc/sys/kernel/random/boot_id',
    '    topo_agent_start_ticks ${topo_agent_stat##*) }',
    '    case "$topo_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$topo_agent_boot" ] || topo_agent_process="{\\"pid\\":$TOPO_HOOK_AGENT_PID,\\"platform\\":\\"linux\\",\\"startTime\\":\\"$topo_agent_boot:$topo_agent_start\\"}" ;; esac',
    // Bash sets OSTYPE on macOS; other shells still ask uname.
    '  elif case "${OSTYPE-}" in darwin*) ;; *) [ "$(uname -s 2>/dev/null)" = Darwin ] ;; esac; then',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    topo_agent_start=$(TZ=UTC0 LC_ALL=C exec /bin/ps -p "$TOPO_HOOK_AGENT_PID" -o lstart= 2>/dev/null)',
    '    topo_agent_start=${topo_agent_start#"${topo_agent_start%%[! ]*}"}',
    '    topo_agent_start=${topo_agent_start%"${topo_agent_start##*[! ]}"}',
    '    [ -z "$topo_agent_start" ] || topo_agent_process="{\\"pid\\":$TOPO_HOOK_AGENT_PID,\\"platform\\":\\"darwin\\",\\"startTime\\":\\"$topo_agent_start\\"}"',
    '  fi ;;',
    'esac',
    // A tmux pane's own server, socket and pane id; only a lookup hint for the host's attachment check.
    'topo_tmux_pane=',
    'case "${TMUX_PANE:-}" in %[0-9]*) [ -z "${TMUX:-}" ] || topo_tmux_pane="$TMUX_PANE ${TMUX%,*,*}" ;; esac'
  ]
}
