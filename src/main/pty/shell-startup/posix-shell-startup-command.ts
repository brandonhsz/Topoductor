import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'TOPO_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __topo_remove_startup_command_prompt_hook() {
    local __topo_item
    local -a __topo_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __topo_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__topo_item" == "__topo_run_startup_command" ]] || __topo_remaining+=("$__topo_item")
      done
      PROMPT_COMMAND=("\${__topo_remaining[@]+"\${__topo_remaining[@]}"}")
    else
      for __topo_item in "\${__topo_prompt_command_suffix[@]+"\${__topo_prompt_command_suffix[@]}"}"; do
        [[ "$__topo_item" == "__topo_run_startup_command" ]] || __topo_remaining+=("$__topo_item")
      done
      __topo_prompt_command_suffix=("\${__topo_remaining[@]+"\${__topo_remaining[@]}"}")
    fi
  }
  __topo_run_startup_command() {
    local __topo_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __topo_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __topo_remove_startup_command_prompt_hook
    unset -f __topo_remove_startup_command_prompt_hook
    builtin history -s "$__topo_command" 2>/dev/null || true
    builtin printf '%s\n' "$__topo_command"
    eval "$__topo_command"
    __topo_status=$?
    unset -f __topo_run_startup_command
    return "$__topo_status"
  }
  __topo_append_prompt_command "__topo_run_startup_command"
fi`
}
