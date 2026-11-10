/** Re-read account selection on every launch in Topo-routed panes with a real claude binary. Missing/empty pointer restores the user’s config; another pane override wins. Create account homes without a login silently and preserve Anthropic auth. Refuse nonabsolute pointers rather than run under the wrong account. */
export function getPosixClaudeShellFunction(): string {
  return `__topo_claude_binary="$(unalias claude 2>/dev/null || :; command -v claude 2>/dev/null || :)"
# Why typeset -f: a user's own claude function wins; command -v prints its bare name, which -x tests against the cwd.
if ! typeset -f claude >/dev/null 2>&1 && [[ -n "\${TOPO_CLAUDE_PROFILE_POINTER:-}" && -n "\${__topo_claude_binary:-}" && -x "\${__topo_claude_binary}" ]]; then
  function claude {
    local __topo_claude_home __topo_claude_pointer="\${TOPO_CLAUDE_PROFILE_POINTER:-}"
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    case "$__topo_claude_pointer" in '~/'*) __topo_claude_pointer="\${HOME:-}/\${__topo_claude_pointer#??}" ;; esac
    __topo_claude_home="$(cat "$__topo_claude_pointer" 2>/dev/null || :)"
    if [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ "$CLAUDE_CONFIG_DIR" != "\${TOPO_CLAUDE_INJECTED_CONFIG_DIR:-}" ] &&
      { [ -z "\${TOPO_CLAUDE_USER_CONFIG_DIR:-}" ] || [ "\${CLAUDE_CONFIG_DIR%/}" != "\${TOPO_CLAUDE_USER_CONFIG_DIR%/}" ]; }; then
      command claude "$@"; return
    fi
    # Why: Topo's value replaced the user's own at spawn, so System default restores theirs.
    if [ -z "$__topo_claude_home" ] && [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ -n "\${TOPO_CLAUDE_USER_CONFIG_DIR:-}" ]; then
      ( unset TOPO_CLAUDE_INJECTED_CONFIG_DIR; export CLAUDE_CONFIG_DIR="$TOPO_CLAUDE_USER_CONFIG_DIR"; command claude "$@" ); return
    fi
    if [ -z "$__topo_claude_home" ]; then
      ( unset CLAUDE_CONFIG_DIR TOPO_CLAUDE_INJECTED_CONFIG_DIR; command claude "$@" ); return
    fi
    case "$__topo_claude_home" in /*|[A-Za-z]:*) ;; *) return 1 ;; esac
    # Why -m 700: matches the folder Topo's setup creates; a credentials folder stays private.
    [ -d "$__topo_claude_home" ] || mkdir -p -m 700 -- "$__topo_claude_home" 2>/dev/null
    ( export CLAUDE_CONFIG_DIR="$__topo_claude_home" TOPO_CLAUDE_INJECTED_CONFIG_DIR="$__topo_claude_home"; command claude "$@" )
  }
fi
unset __topo_claude_binary
`
}

/** Leading newline separates the preceding codex fragment, which has no trailing newline. */
export function getFishClaudeShellFunction(): string {
  return `
set -l __topo_claude_type (type -t claude 2>/dev/null)
if test -n "$TOPO_CLAUDE_PROFILE_POINTER"; and test "$__topo_claude_type" = file
  function claude
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    set -l pointer (string replace -r '^~/' "$HOME/" -- "$TOPO_CLAUDE_PROFILE_POINTER")
    set -l profile (cat "$pointer" 2>/dev/null)
    set -l own (string trim -r -c / -- "$TOPO_CLAUDE_USER_CONFIG_DIR")
    set -l current (string trim -r -c / -- "$CLAUDE_CONFIG_DIR")
    if test -n "$CLAUDE_CONFIG_DIR"; and test "$CLAUDE_CONFIG_DIR" != "$TOPO_CLAUDE_INJECTED_CONFIG_DIR"; and begin; test -z "$own"; or test "$current" != "$own"; end
      command claude $argv
      return $status
    end
    if test -z "$profile"; and test -n "$CLAUDE_CONFIG_DIR"; and test -n "$TOPO_CLAUDE_USER_CONFIG_DIR"
      env -u TOPO_CLAUDE_INJECTED_CONFIG_DIR CLAUDE_CONFIG_DIR="$TOPO_CLAUDE_USER_CONFIG_DIR" claude $argv
      return $status
    end
    if test -z "$profile"
      env -u CLAUDE_CONFIG_DIR -u TOPO_CLAUDE_INJECTED_CONFIG_DIR claude $argv
      return $status
    end
    if not string match -qr '^(/|[A-Za-z]:)' -- "$profile"
      return 1
    end
    test -d "$profile"; or mkdir -p -m 700 -- "$profile" 2>/dev/null
    env CLAUDE_CONFIG_DIR="$profile" TOPO_CLAUDE_INJECTED_CONFIG_DIR="$profile" claude $argv
  end
end
set -e __topo_claude_type
`
}

export function getPowerShellClaudeShellFunction(): string {
  return `$topoClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
if ($env:TOPO_CLAUDE_PROFILE_POINTER -and $topoClaudeCommand -and
    $topoClaudeCommand.CommandType -in @("Application", "ExternalScript")) {
function Global:claude {
    $names = @('CLAUDE_CONFIG_DIR', 'TOPO_CLAUDE_INJECTED_CONFIG_DIR')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $topoClaudeHome = ''
        if ($env:TOPO_CLAUDE_PROFILE_POINTER -and (Test-Path -LiteralPath $env:TOPO_CLAUDE_PROFILE_POINTER -PathType Leaf)) {
            $topoClaudeHome = [IO.File]::ReadAllText($env:TOPO_CLAUDE_PROFILE_POINTER).TrimEnd()
        }
        # Why the separator swap: Windows names one folder with either separator.
        $own = ("$env:TOPO_CLAUDE_USER_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\')
        if ($env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR -ne $env:TOPO_CLAUDE_INJECTED_CONFIG_DIR -and
            (-not $own -or ("$env:CLAUDE_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\') -ne $own)) {
            # A value set in this pane, other than the user's own, wins.
        } elseif (-not $topoClaudeHome) {
            Remove-Item Env:TOPO_CLAUDE_INJECTED_CONFIG_DIR -ErrorAction SilentlyContinue
            if ($env:CLAUDE_CONFIG_DIR -and $env:TOPO_CLAUDE_USER_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR = $env:TOPO_CLAUDE_USER_CONFIG_DIR }
            else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        } elseif (-not [IO.Path]::IsPathRooted($topoClaudeHome)) {
            $global:LASTEXITCODE = 1
            return
        } else {
            if (-not [IO.Directory]::Exists($topoClaudeHome)) { $null = New-Item -ItemType Directory -Path $topoClaudeHome -Force -ErrorAction SilentlyContinue }
            $env:CLAUDE_CONFIG_DIR = $topoClaudeHome
            $env:TOPO_CLAUDE_INJECTED_CONFIG_DIR = $topoClaudeHome
        }
        $binary = Get-Command claude -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1
        $claudeArgs = @(__TopoEscapeNativeArgs $binary.Source $args)
        if ($MyInvocation.ExpectingInput) { $input | & $binary.Source @claudeArgs } else { & $binary.Source @claudeArgs }
        $global:LASTEXITCODE = $LASTEXITCODE
    } catch { $global:LASTEXITCODE = 1; Write-Error $_ -ErrorAction Continue }
    finally {
        # Why Remove-Item: on .NET 9+ a $null value (passed as "") creates the variable empty instead of deleting it.
        foreach ($name in $names) {
            if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
        }
    }
}
}
Remove-Variable topoClaudeCommand -ErrorAction SilentlyContinue
`
}
