export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__topo_normalize_prompt_command_part() {
  local __topo_value="$1" __topo_output_name="$2" __topo_character __topo_chunk
  local __topo_value_length=\${#1} __topo_suffix_length=0 __topo_backslash_length=0
  local __topo_output_length __topo_scan_start
  while (( __topo_value_length - __topo_suffix_length >= 1024 )); do
    __topo_scan_start=$(( __topo_value_length - __topo_suffix_length - 1024 ))
    __topo_chunk="\${__topo_value:__topo_scan_start:1024}"
    case "$__topo_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __topo_suffix_length=$(( __topo_suffix_length + 1024 )) ;;
    esac
  done
  while (( __topo_suffix_length < __topo_value_length )); do
    __topo_character="\${__topo_value: -__topo_suffix_length - 1:1}"
    case "$__topo_character" in
      ' '|$'\\t'|$'\\n'|';') __topo_suffix_length=$(( __topo_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __topo_output_length=$(( \${#__topo_value} - __topo_suffix_length ))
  while (( __topo_output_length - __topo_backslash_length >= 1024 )); do
    __topo_scan_start=$(( __topo_output_length - __topo_backslash_length - 1024 ))
    __topo_chunk="\${__topo_value:__topo_scan_start:1024}"
    case "$__topo_chunk" in
      *[!\\\\]*) break ;;
      *) __topo_backslash_length=$(( __topo_backslash_length + 1024 )) ;;
    esac
  done
  while (( __topo_backslash_length < __topo_output_length )); do
    __topo_character="\${__topo_value:__topo_output_length - __topo_backslash_length - 1:1}"
    [[ "$__topo_character" == '\\' ]] || break
    __topo_backslash_length=$(( __topo_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __topo_suffix_length > 0 && __topo_backslash_length % 2 == 1 )); then
    __topo_suffix_length=$(( __topo_suffix_length - 1 ))
    __topo_backslash_length=0
  fi
  __topo_output_length=$(( \${#__topo_value} - __topo_suffix_length ))
  __topo_value="\${__topo_value:0:__topo_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __topo_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __topo_backslash_length % 2 == 1 )); then
    __topo_value="$__topo_value\\\\"
  fi
  printf -v "$__topo_output_name" '%s' "$__topo_value"
}
__topo_restore_prompt_status() {
  return "$1"
}
__topo_update_user_debug_trap() {
  local __topo_debug_trap_spec="$1" __topo_unchanged_debug_trap_spec="$2"
  local __topo_debug_trap_command
  [[ "$__topo_debug_trap_spec" != "$__topo_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__topo_debug_trap_spec" != "trap -- '__topo_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__topo_debug_trap_spec" ]]; then
    __topo_user_debug_trap=""
    unset __topo_chained_debug_trap
    return 0
  fi
  __topo_debug_trap_command="\${__topo_debug_trap_spec#trap -- }"
  __topo_debug_trap_command="\${__topo_debug_trap_command% DEBUG}"
  eval "__topo_user_debug_trap=$__topo_debug_trap_command"
  unset __topo_chained_debug_trap
}
__topo_run_user_debug_trap() {
  if [[ -n "\${__topo_user_debug_trap:-}" ]]; then
    eval "$__topo_user_debug_trap" || true
  fi
}
__topo_adopt_outer_debug_trap() {
  local __topo_debug_trap_spec="\${__topo_outer_debug_trap_spec:-}"
  unset __topo_outer_debug_trap_spec
  __topo_update_user_debug_trap "$__topo_debug_trap_spec" "trap -- '__topo_osc133_preexec' DEBUG"
}
__topo_run_prompt_command_array() {
  local __topo_exit_code="\${__topo_prompt_status:-$?}" __topo_prompt_part __topo_prompt_index __topo_user_count
  local __topo_suffix_part
  local __topo_final_prompt_command
  local __topo_in_prompt_dispatch=1 __topo_dispatching_user_prompt_command=""
  unset __topo_prompt_status
  __topo_adopt_outer_debug_trap
  trap '__topo_osc133_preexec' DEBUG
  for __topo_prompt_part in "\${__topo_prompt_command_prefix[@]+"\${__topo_prompt_command_prefix[@]}"}"; do
    if (( __topo_exit_code == 0 )); then
      eval "$__topo_prompt_part"
    else
      __topo_restore_prompt_status "$__topo_exit_code" || eval "$__topo_prompt_part"
    fi
  done
  __topo_user_count=0
  for __topo_prompt_part in "\${__topo_prompt_command_array[@]+"\${__topo_prompt_command_array[@]}"}"; do
    __topo_user_count=$(( __topo_user_count + 1 ))
  done
  for (( __topo_prompt_index = 0; __topo_prompt_index + 1 < __topo_user_count; __topo_prompt_index++ )); do
    __topo_prompt_part="\${__topo_prompt_command_array[__topo_prompt_index]}"
    __topo_dispatching_user_prompt_command=1
    if (( __topo_exit_code == 0 )); then
      eval "$__topo_prompt_part"
    else
      __topo_restore_prompt_status "$__topo_exit_code" || eval "$__topo_prompt_part"
    fi
    __topo_dispatching_user_prompt_command=""
  done
  if (( __topo_user_count > 0 )); then
    __topo_prompt_part="\${__topo_prompt_command_array[__topo_user_count - 1]}"
    # Why: keep the final user hook and Topo suffixes in one status-preserving eval.
    __topo_final_prompt_command='eval "$__topo_prompt_part"'
    for __topo_suffix_part in "\${__topo_prompt_command_suffix[@]+"\${__topo_prompt_command_suffix[@]}"}"; do
      __topo_final_prompt_command+=$'\\n'"$__topo_suffix_part"
    done
    __topo_dispatching_user_prompt_command=1
    if (( __topo_exit_code == 0 )); then
      eval "$__topo_final_prompt_command"
    else
      __topo_restore_prompt_status "$__topo_exit_code" || eval "$__topo_final_prompt_command"
    fi
    __topo_dispatching_user_prompt_command=""
  else
    for __topo_prompt_part in "\${__topo_prompt_command_suffix[@]+"\${__topo_prompt_command_suffix[@]}"}"; do
      if (( __topo_exit_code == 0 )); then
        eval "$__topo_prompt_part"
      else
        __topo_restore_prompt_status "$__topo_exit_code" || eval "$__topo_prompt_part"
      fi
    done
  fi
  return "$__topo_exit_code"
}
__topo_finish_legacy_prompt_dispatch() {
  local __topo_suffix_part
  if [[ -n "\${__topo_in_prompt_command:-}" ]]; then
    for __topo_suffix_part in "\${__topo_prompt_command_suffix[@]+"\${__topo_prompt_command_suffix[@]}"}"; do
      eval "$__topo_suffix_part"
    done
  fi
}
__topo_normalize_prompt_command() {
  [[ -z "\${__topo_prompt_command_normalized:-}" ]] || return 0
  local __topo_prompt_part
  local -a __topo_normalized=()
  for __topo_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __topo_normalize_prompt_command_part "$__topo_prompt_part" __topo_prompt_part
    [[ -n "$__topo_prompt_part" ]] && __topo_normalized+=("$__topo_prompt_part")
  done
  __topo_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__topo_normalized[@]+"\${__topo_normalized[@]}"}")
  else
    __topo_prompt_command_array=("\${__topo_normalized[@]+"\${__topo_normalized[@]}"}")
    __topo_prompt_command_prefix=()
    __topo_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __topo_prompt_status_variable="__topo_prompt_status_$$"
    __topo_prompt_status_capture_command="$__topo_prompt_status_variable=\\$?"
    __topo_prompt_status_value="\\\${$__topo_prompt_status_variable}"
    # Why: a changed DEBUG trap misses the capture command, and bash <= 4.3 reverts traps set in functions.
    PROMPT_COMMAND="$__topo_prompt_status_capture_command; __topo_in_legacy_prompt_wrapper=1; __topo_prompt_status=$__topo_prompt_status_value"'; __topo_prompt_had_functrace=""; if [[ -o functrace ]]; then __topo_prompt_had_functrace=1; set +T; fi; __topo_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__topo_prompt_had_functrace" ]] || set -T; unset __topo_prompt_had_functrace; __topo_run_prompt_command_array; __topo_finish_legacy_prompt_dispatch; trap __topo_osc133_preexec DEBUG; unset __topo_in_legacy_prompt_wrapper'
  fi
}
__topo_prepend_prompt_command() {
  local command="$1"
  __topo_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __topo_prompt_command_prefix=("$command" "\${__topo_prompt_command_prefix[@]+"\${__topo_prompt_command_prefix[@]}"}")
  fi
}
__topo_append_prompt_command() {
  local command="$1"
  __topo_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __topo_prompt_command_suffix+=("$command")
  fi
}`
