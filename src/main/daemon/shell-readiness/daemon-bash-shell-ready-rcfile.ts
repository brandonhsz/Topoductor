import { getPosixOmpShellWrapper } from '../../pty/shell-startup/omp-shell-wrapper'
import { TOPO_CLI_POSIX_PATH_RESTORE } from '../../../shared/topo-cli-shell-path'
import { MANAGED_DATA_ACCOUNT_POSIX_RESTORE } from '../../../shared/managed-data-account-shell'
import { getPosixCodexShellLaunchPreflight } from '../../../shared/codex-shell-function'
import { getPosixClaudeShellFunction } from '../../../shared/claude-shell-function'
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../../pty/shell-startup/bash-prompt-command-composition'
import {
  BASH_FEATURE_CHANNEL_BLOCK,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK
} from '../../pty/shell-startup/shell-templates'

export function getDaemonBashShellReadyRcfileContent(): string {
  return `# Topo daemon bash shell-ready wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Consume the feature channel before profiles so child processes cannot inherit the selection.
__topo_ready_marker=""
__topo_has_feature ready && __topo_ready_marker=1
unset _topo_shell_features
unset -f __topo_has_feature
# A system bashrc may already run ble.sh; it never exports this state, so exported copies are inherited.
for __topo_ble_var in _ble_attached _ble_decode_bind_state; do
  [[ -n "\${!__topo_ble_var+set}" ]] || continue
  case "$(declare -p "$__topo_ble_var" 2>/dev/null)" in "declare -x"*) unset "$__topo_ble_var" ;; esac
done
unset __topo_ble_var
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Force bracketed paste on older readline so multiline startup prompts remain one literal paste.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
__topo_restore_agent_teams_path() {
  [[ -n "\${TOPO_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${TOPO_AGENT_TEAMS_SHIM_DIR}"|"\${TOPO_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${TOPO_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__topo_restore_agent_teams_path
${TOPO_CLI_POSIX_PATH_RESTORE}
# Restore the managed OpenCode config after user profiles may have replaced it.
[[ -n "\${TOPO_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${TOPO_OPENCODE_CONFIG_DIR}"
${MANAGED_DATA_ACCOUNT_POSIX_RESTORE}
[[ -n "\${TOPO_MIMOCODE_CONFIG_DIR:-}" ]] && export MIMOCODE_CONFIG_DIR="\${TOPO_MIMOCODE_CONFIG_DIR}"
${getPosixOmpShellWrapper()}
# Preserve the managed CODEX_HOME after user profiles.
[[ -n "\${TOPO_CODEX_HOME:-}" ]] && export CODEX_HOME="\${TOPO_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight() + getPosixClaudeShellFunction()}
# OSC 133 C/D clears stale agent status when a CLI exits without a stop hook.
__topo_initializing_wrapper=1
__topo_osc133_precmd() {
  local exit_code=$?
  __topo_in_prompt_command=1
  if [[ -n "\${__topo_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __topo_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__topo_osc133_preexec() {
  if [[ -n "\${__topo_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__topo_prompt_status_capture_command" ]]; then
    unset __topo_initial_prompt
    __topo_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__topo_initializing_wrapper:-}\${__topo_in_debug_capture:-}\${__topo_initial_prompt:-}\${__topo_in_prompt_dispatch:-}\${__topo_in_legacy_prompt_wrapper:-}\${__topo_in_prompt_command:-}" ]]; then
    [[ -z "\${__topo_initializing_wrapper:-}\${__topo_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__topo_initial_prompt:-}" && "$BASH_COMMAND" == "__topo_osc133_precmd" ]]; then
      unset __topo_initial_prompt; return 0
    fi
    if [[ -n "\${__topo_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__topo_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__topo_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __topo_exit_code == 0 ))'|'__topo_restore_prompt_status "$__topo_exit_code"'|'eval "$__topo_prompt_part"'|'eval "$__topo_final_prompt_command"'|__topo_dispatching_user_prompt_command=*|__topo_osc133_precmd|__topo_osc133_epilogue) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__topo_run_prompt_command_array" || "$BASH_COMMAND" == "__topo_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__topo_in_legacy_prompt_wrapper:-}" || -n "\${__topo_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__topo_in_prompt_command:-}" && "$BASH_COMMAND" == "__topo_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in
    __topo_osc133_*|__topo_restore_prompt_status|__bp_*) return 0 ;;
  esac
  case "$BASH_COMMAND" in
    __topo_osc133_precmd|__topo_osc133_epilogue) return 0 ;;
    # The prefix is only special while bash-preexec prompt hooks run.
    __bp_*) [[ -n "\${__topo_in_prompt_command:-}" ]] && return 0 ;;
  esac
  __topo_run_user_debug_trap
  # Chain the framework trap captured before each prompt's lifecycle re-arm.
  if [[ -n "\${__topo_chained_debug_trap:-}" ]]; then
    eval "$__topo_chained_debug_trap" || true
  fi
  [[ -z "\${__topo_in_prompt_command:-}" ]] || return 0
  # Emit C once per foreground command, excluding prompt hooks and repeated chained-trap calls.
  [[ -z "\${__topo_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __topo_in_command=1
}
# Adopt the latest user trap before reclaiming lifecycle ownership.
__topo_osc133_epilogue() {
  unset __topo_in_prompt_command
  __topo_adopt_outer_debug_trap
  trap '__topo_osc133_preexec' DEBUG
  # Readline renders PS1 after entering raw mode; prompt hooks still run in cooked mode.
  if [[ -n "$__topo_ready_marker" ]]; then
    # Attached ble.sh (0.3+) discards Bash's own prompt output and owns the TTY, so print directly.
    if [[ -n "\${_ble_attached-}" ]]; then
      # Its first render runs this before the key decoder attaches; wait for a later prompt.
      if [[ "\${_ble_decode_bind_state:-none}" != none ]]; then
        printf "\\033]777;topo-shell-ready\\007"
        __topo_ready_marker=""
      fi
    else
      PS1="\${PS1-}"'\\[\\e]777;topo-shell-ready\\a\\]'
      __topo_ready_marker=""
    fi
  fi
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__topo_prepend_prompt_command "__topo_osc133_precmd"
__topo_append_prompt_command '__topo_in_debug_capture=1; __topo_prompt_had_functrace=""; if [[ -o functrace ]]; then __topo_prompt_had_functrace=1; set +T; fi; __topo_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__topo_prompt_had_functrace" ]] || set -T; unset __topo_prompt_had_functrace __topo_in_debug_capture'
__topo_append_prompt_command "__topo_osc133_epilogue"
__topo_had_functrace=""
[[ -o functrace ]] && __topo_had_functrace=1
set +T
__topo_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__topo_had_functrace" ]] || set -T
if [[ -n "$__topo_debug_trap_spec" && "$__topo_debug_trap_spec" != "trap -- '__topo_osc133_preexec' DEBUG" ]]; then
  __topo_debug_trap_command="\${__topo_debug_trap_spec#trap -- }"
  __topo_debug_trap_command="\${__topo_debug_trap_command% DEBUG}"
  eval "__topo_user_debug_trap=$__topo_debug_trap_command"
fi
unset __topo_debug_trap_spec __topo_debug_trap_command __topo_had_functrace
unset -f __topo_normalize_prompt_command_part __topo_normalize_prompt_command __topo_prepend_prompt_command __topo_append_prompt_command
unset __topo_prompt_command_normalized
# Arm DEBUG after setup so rcfile commands cannot emit a fake lifecycle before the first prompt.
__topo_initial_prompt=1
trap '__topo_osc133_preexec' DEBUG
unset __topo_initializing_wrapper
`
}
