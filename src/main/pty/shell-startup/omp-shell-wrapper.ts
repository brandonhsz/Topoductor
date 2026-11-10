// Typed OMP needs Topo's status extension explicitly; preserve PI_CODING_AGENT_DIR as the user's mutable auth/config/session home.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join('|')
  return `# Why: OMP does not auto-load Topo's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__topo_omp_should_skip_extension() {
  case "\${1:-}" in
    'help'|'--help'|'-h'|'--version'|'-v') return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__topo_omp_cwd_is_usable() {
  local __topo_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __topo_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__topo_physical_cwd" && "$__topo_physical_cwd" -ef . ]]
  fi
}
__topo_omp_invoke() {
  local __topo_use_extension="$1"
  shift
  if [[ $__topo_use_extension -eq 1 && -n "\${TOPO_OMP_STATUS_EXTENSION:-}" && -f "\${TOPO_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${TOPO_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${TOPO_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__topo_omp() {
  local __topo_use_extension=1
  __topo_omp_should_skip_extension "\${1:-}" && __topo_use_extension=0
  if ! __topo_omp_cwd_is_usable; then
    local __topo_logical_cwd="\${PWD:-\${TOPO_WORKTREE_PATH:-\${TOPO_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__topo_logical_cwd" ]]; then
        printf 'Topo: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__topo_logical_cwd" 2>/dev/null; then
        printf 'Topo: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__topo_logical_cwd" >&2
        return 1
      fi
      __topo_omp_invoke "$__topo_use_extension" "$@"
    )
  else
    __topo_omp_invoke "$__topo_use_extension" "$@"
  fi
}
if [[ -n "\${TOPO_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __topo_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load Topo's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__TopoOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:TOPO_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $topoUseExtension = -not (__TopoOmpShouldSkipExtension -Name ([string]($args[0])))
        $topoStatus = 0
        $topoCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $topoCommand) {
            Write-Error "omp executable not found"
            $topoStatus = 127
        } elseif ($topoUseExtension -and $env:TOPO_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:TOPO_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $topoLaunchArgs = @($args | Select-Object -Skip 1)
                & $topoCommand.Source launch --extension $env:TOPO_OMP_STATUS_EXTENSION @topoLaunchArgs
            } else {
                & $topoCommand.Source --extension $env:TOPO_OMP_STATUS_EXTENSION @args
            }
            $topoStatus = $LASTEXITCODE
        } else {
            & $topoCommand.Source @args
            $topoStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $topoStatus
    }
}
`
}
