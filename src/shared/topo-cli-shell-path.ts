export const TOPO_CLI_POSIX_PATH_RESTORE = `if [ -n "\${TOPO_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$TOPO_CLI_BIN_DIR"|"$TOPO_CLI_BIN_DIR":*) ;;
    *) export PATH="$TOPO_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`
