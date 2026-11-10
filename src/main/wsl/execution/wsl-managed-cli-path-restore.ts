/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${TOPO_WSL_CLI_DIR:-}" ]; then
  if [ -x "$TOPO_WSL_CLI_DIR/\${TOPO_CLI_COMMAND:-}" ]; then
    export PATH="$TOPO_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Topo CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$TOPO_WSL_CLI_DIR/\${TOPO_CLI_COMMAND:-}" >&2
  fi
fi`
