/**
 * A WSL bridge shell reports its folder at each prompt (OSC 7), so the terminal daemon's emulator,
 * and every checkpoint, follows `cd` without a guest probe. Bridge bash and zsh send none
 * themselves. Only inside WSL. The path is encoded only when it changes, and re-sent every
 * prompt so a foreign report (an ssh session that set its own) cannot stick. Bytes outside the
 * URI's unreserved set are percent-encoded as UTF-8, masked for bash 3.2's signed chars.
 */
export const BASH_WSL_CWD_REPORT_BLOCK = `__topo_wsl_cwd_report() {
  [[ -n "\${WSL_DISTRO_NAME:-}" ]] || return 0
  if [[ "$PWD" != "\${__topo_wsl_cwd_reported-}" ]]; then
    __topo_wsl_cwd_reported=$PWD
    local LC_ALL=C __topo_e= __topo_c __topo_i
    for (( __topo_i = 0; __topo_i < \${#PWD}; __topo_i++ )); do
      __topo_c=\${PWD:__topo_i:1}
      case $__topo_c in
        [A-Za-z0-9/._~-]) __topo_e+=$__topo_c ;;
        *) printf -v __topo_c '%d' "'$__topo_c"; printf -v __topo_c '%%%02X' $(( __topo_c & 255 )); __topo_e+=$__topo_c ;;
      esac
    done
    __topo_wsl_cwd_encoded=$__topo_e
  fi
  printf '\\033]7;file://%s\\007' "\${__topo_wsl_cwd_encoded-}"
}`

export const ZSH_WSL_CWD_REPORT_BLOCK = `__topo_wsl_cwd_report() {
  builtin emulate -L zsh
  builtin setopt no_multibyte
  [[ -n \${WSL_DISTRO_NAME:-} ]] || return 0
  if [[ $PWD != \${__topo_wsl_cwd_reported-} ]]; then
    builtin typeset -g __topo_wsl_cwd_reported=$PWD
    local __topo_e= __topo_c __topo_i
    for (( __topo_i = 1; __topo_i <= $#PWD; __topo_i++ )); do
      __topo_c=$PWD[__topo_i]
      case $__topo_c in
        ([A-Za-z0-9/._~-]) __topo_e+=$__topo_c ;;
        (*) builtin printf -v __topo_c '%d' "'$__topo_c"; builtin printf -v __topo_c '%%%02X' $(( __topo_c & 255 )); __topo_e+=$__topo_c ;;
      esac
    done
    builtin typeset -g __topo_wsl_cwd_encoded=$__topo_e
  fi
  builtin printf '\\033]7;file://%s\\007' "\${__topo_wsl_cwd_encoded-}"
}`

/**
 * A WSL bridge sh/dash/ash pane's ENV file (read once, by interactive shells only, after the login
 * profile). It first hands ENV back to the user's own value, so children see theirs, and sources it.
 * Then, inside WSL, it prefixes PS1 with the folder report; dash has no prompt hook, so the report
 * runs in a command substitution and re-encodes $PWD byte by byte every prompt. bash and busybox
 * ash (fancy prompt, on in Alpine's and Debian's builds) get it inside \\[ \\] so the invisible bytes
 * do not count toward the prompt's width; dash has no line editor to miscount, and would print \\[.
 */
export const SH_WSL_ENV_FILE = `# Topo WSL bridge sh ENV: restore the user's ENV, then report the folder (OSC 7) at each prompt.
if [ -n "\${TOPO_WSL_USER_ENV:-}" ]; then
  ENV=$TOPO_WSL_USER_ENV
  unset TOPO_WSL_USER_ENV
  # The shell expands ENV's value before reading it; a here-document does the same without
  # parsing the user's quotes as shell syntax.
  eval "IFS= read -r __topo_user_env <<__TOPO_USER_ENV_EOF
$ENV
__TOPO_USER_ENV_EOF
"
  if [ -r "$__topo_user_env" ]; then
    . "$__topo_user_env"
  fi
  unset __topo_user_env
else
  unset ENV TOPO_WSL_USER_ENV
fi
if [ -n "\${WSL_DISTRO_NAME:-}" ]; then
  __topo_wsl_cwd_report() {
    LC_ALL=C
    __topo_p=$PWD
    __topo_e=
    while [ -n "$__topo_p" ]; do
      __topo_r=\${__topo_p#?}
      __topo_c=\${__topo_p%"$__topo_r"}
      __topo_p=$__topo_r
      case $__topo_c in
        [A-Za-z0-9/._~-]) __topo_e=$__topo_e$__topo_c ;;
        *) __topo_e=$__topo_e$(printf '%%%02X' $(( $(printf '%d' "'$__topo_c") & 255 ))) ;;
      esac
    done
    printf '\\033]7;file://%s\\007' "$__topo_e"
  }
  case $PS1 in
    *__topo_wsl_cwd_report*) ;;
    *)
      if [ -n "\${BASH_VERSION:-}" ] || [ -n "\${BB_ASH_VERSION:-}" ]; then
        PS1='\\[$(__topo_wsl_cwd_report)\\]'"$PS1"
      else
        PS1='$(__topo_wsl_cwd_report)'"$PS1"
      fi
      ;;
  esac
fi
`
