import {
  WINDOWS_CLAUDE_BACKGROUND_JOB_GUARD,
  buildPosixClaudeBackgroundJobGuardLines
} from '../agent-hooks/installation/scripts/claude-background-job-guard'
import { posixCurlCommand } from '../agent-hooks/installation/scripts/hook-post-command'
import { WINDOWS_HOOK_STDIN_READER } from '../agent-hooks/installation/scripts/hook-stdin-contract'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'
import { wrapWindowsDirectCmdHookCommand } from '../agent-hooks/installation/commands/windows-direct-cmd-hook-command'
import { getManagedCommand } from './hook-settings'

const STATUSLINE_CLEANUP_LABEL = 'topo_statusline_cleanup'
const STATUSLINE_PROBE_LABEL = 'topo_statusline_probe'

// PowerShell needs a bare safe path; unsafe paths keep runtime HOME to avoid per-tick PowerShell spawns.
export function getManagedStatusLineCommand(scriptPath: string): string {
  return (
    (process.platform === 'win32' ? wrapWindowsDirectCmdHookCommand(scriptPath) : null) ??
    getManagedCommand(scriptPath)
  )
}

// Forward live usage without OAuth polling; emit no stdout to preserve the terminal statusline.
export function getManagedStatusLineScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      WINDOWS_CLAUDE_BACKGROUND_JOB_GUARD,
      // Endpoint refresh never sets the pane key, so this guard can precede stdin capture.
      'if "%TOPO_PANE_KEY%"=="" exit /b 0',
      // UUID suffixes and sanitized legacy delimiters keep filenames safe.
      'set "TOPO_STATUSLINE_PANE_ID=%TOPO_PANE_KEY:~-36%"',
      'set "TOPO_STATUSLINE_PANE_ID=%TOPO_STATUSLINE_PANE_ID::=_%"',
      // Buffer before spawning curl; per-pane names avoid same-second %RANDOM% collisions.
      'set "TOPO_STATUSLINE_PAYLOAD_FILE=%TEMP%\\topo-claude-statusline-%TOPO_STATUSLINE_PANE_ID%.tmp"',
      `${WINDOWS_HOOK_STDIN_READER} >"%TOPO_STATUSLINE_PAYLOAD_FILE%" 2>nul`,
      // Builtin throttling avoids findstr and curl spawns on streaming ticks.
      'set "TOPO_STATUSLINE_STAMP_FILE=%TEMP%\\topo-claude-statusline-last-%TOPO_STATUSLINE_PANE_ID%.tmp"',
      'set "TOPO_STATUSLINE_NOW="',
      'set "TOPO_STATUSLINE_TIME=%TIME: =0%"',
      'for /f "tokens=1-3 delims=:.," %%a in ("%TOPO_STATUSLINE_TIME%") do set /a "TOPO_STATUSLINE_NOW=(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)" 2>nul',
      'set "TOPO_STATUSLINE_LAST="',
      'set "TOPO_STATUSLINE_ELAPSED="',
      'if exist "%TOPO_STATUSLINE_STAMP_FILE%" set /p TOPO_STATUSLINE_LAST=<"%TOPO_STATUSLINE_STAMP_FILE%"',
      'if defined TOPO_STATUSLINE_LAST for /f "delims=0123456789" %%d in ("%TOPO_STATUSLINE_LAST%") do set "TOPO_STATUSLINE_LAST="',
      'if defined TOPO_STATUSLINE_NOW if defined TOPO_STATUSLINE_LAST set /a "TOPO_STATUSLINE_ELAPSED=TOPO_STATUSLINE_NOW-TOPO_STATUSLINE_LAST" 2>nul',
      `if not defined TOPO_STATUSLINE_ELAPSED goto :${STATUSLINE_PROBE_LABEL}`,
      `if %TOPO_STATUSLINE_ELAPSED% GEQ 0 if %TOPO_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :${STATUSLINE_CLEANUP_LABEL}`,
      `:${STATUSLINE_PROBE_LABEL}`,
      // Non-subscriber payloads lack rate_limits; skip their endpoint lookup and curl spawn.
      // Escaped quotes match the JSON key, avoiding false matches in paths.
      '"%SystemRoot%\\System32\\findstr.exe" /c:\\"rate_limits\\" "%TOPO_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
      `if errorlevel 1 goto :${STATUSLINE_CLEANUP_LABEL}`,
      // Refresh stale endpoint coordinates after Topo restarts, falling back to PTY env.
      'if defined TOPO_AGENT_HOOK_ENDPOINT if exist "%TOPO_AGENT_HOOK_ENDPOINT%" call "%TOPO_AGENT_HOOK_ENDPOINT%" 2>nul',
      `if "%TOPO_AGENT_HOOK_PORT%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
      `if "%TOPO_AGENT_HOOK_TOKEN%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
      // Stamp only eligible posts so skipped ticks never postpone the next post.
      'if defined TOPO_STATUSLINE_NOW (>"%TOPO_STATUSLINE_STAMP_FILE%" echo %TOPO_STATUSLINE_NOW%)',
      // An always-defined field posts empty configDir when unset, rather than a literal %VAR%.
      'set "TOPO_STATUSLINE_CONFIG_DIR_FIELD=configDir="',
      'if defined CLAUDE_CONFIG_DIR set "TOPO_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"',
      [
        '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
        `"http://127.0.0.1:%TOPO_AGENT_HOOK_PORT%${CLAUDE_STATUSLINE_PATHNAME}"`,
        '--connect-timeout 0.5 --max-time 1.5',
        '-H "Content-Type: application/x-www-form-urlencoded"',
        '-H "X-Topo-Agent-Hook-Token: %TOPO_AGENT_HOOK_TOKEN%"',
        '--data-urlencode "paneKey=%TOPO_PANE_KEY%"',
        '--data-urlencode "%TOPO_STATUSLINE_CONFIG_DIR_FIELD%"',
        '--data-urlencode "env=%TOPO_AGENT_HOOK_ENV%"',
        '--data-urlencode "version=%TOPO_AGENT_HOOK_VERSION%"',
        '--data-urlencode "payload@%TOPO_STATUSLINE_PAYLOAD_FILE%"',
        '>nul 2>&1'
      ].join(' '),
      `:${STATUSLINE_CLEANUP_LABEL}`,
      'del "%TOPO_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Builtin capture avoids per-tick cat spawns.
    'payload=',
    'while IFS= read -r topo_statusline_line || [ -n "$topo_statusline_line" ]; do',
    '  payload="${payload}${topo_statusline_line}\n"',
    'done',
    'payload=${payload%?}',
    'if [ -z "$payload" ]; then',
    '  exit 0',
    'fi',
    ...buildPosixClaudeBackgroundJobGuardLines(),
    // Non-subscriber payloads lack rate_limits; avoid spawning curl for them.
    'case "$payload" in',
    '  *\'"rate_limits"\'*) ;;',
    '  *) exit 0 ;;',
    'esac',
    'if [ -n "$TOPO_AGENT_HOOK_ENDPOINT" ] && [ -r "$TOPO_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$TOPO_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$TOPO_AGENT_HOOK_PORT" ] || [ -z "$TOPO_AGENT_HOOK_TOKEN" ] || [ -z "$TOPO_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    // The stable leaf UUID excludes path-unsafe and overlong tab IDs.
    'topo_statusline_pane_id=${TOPO_PANE_KEY##*:}',
    // Legacy numeric leaf IDs were tab-local; include a safe tab ID to isolate their stamps.
    'case "$topo_statusline_pane_id" in',
    "  ''|*[!0-9]*) ;;",
    '  *)',
    '    topo_statusline_tab_id=${TOPO_PANE_KEY%:*}',
    '    case "$topo_statusline_tab_id" in',
    "      ''|*[!A-Za-z0-9._-]*) ;;",
    '      *) topo_statusline_pane_id="${topo_statusline_tab_id}_${topo_statusline_pane_id}" ;;',
    '    esac',
    '    ;;',
    'esac',
    'topo_statusline_stamp="${TMPDIR:-/tmp}/topo-claude-statusline-last-${topo_statusline_pane_id}"',
    // Use the payload clock to avoid per-tick date spawns; fall back if the schema changes.
    'topo_statusline_now=',
    'case "$payload" in',
    '  *\'"total_duration_ms"\'*)',
    '    topo_statusline_duration=${payload#*\'"total_duration_ms"\'}',
    '    topo_statusline_duration=${topo_statusline_duration#*:}',
    '    topo_statusline_duration=${topo_statusline_duration#"${topo_statusline_duration%%[![:space:]]*}"}',
    '    topo_statusline_duration=${topo_statusline_duration%%[!0-9]*}',
    '    case "$topo_statusline_duration" in',
    '      0|[1-9]|[1-9][0-9]*)',
    '        if [ "${#topo_statusline_duration}" -le 15 ]; then',
    '          topo_statusline_now=$((topo_statusline_duration / 1000))',
    '        fi',
    '        ;;',
    '    esac',
    '    ;;',
    'esac',
    'if [ -z "$topo_statusline_now" ]; then',
    '  topo_statusline_now=$(date +%s 2>/dev/null) || topo_statusline_now=',
    'fi',
    // Canonical decimals avoid fatal dash octal errors (008); malformed stamps must fail open.
    'case "$topo_statusline_now" in 0|[1-9]|[1-9][0-9]*) ;; *) topo_statusline_now= ;; esac',
    'if [ -n "$topo_statusline_now" ] && [ -f "$topo_statusline_stamp" ]; then',
    '  topo_statusline_last=',
    '  IFS= read -r topo_statusline_last <"$topo_statusline_stamp" 2>/dev/null || :',
    '  case "$topo_statusline_last" in 0|[1-9]|[1-9][0-9]*) ;; *) topo_statusline_last= ;; esac',
    '  if [ "${#topo_statusline_last}" -gt 15 ]; then topo_statusline_last=; fi',
    '  if [ -n "$topo_statusline_last" ]; then',
    '    topo_statusline_elapsed=$((topo_statusline_now - topo_statusline_last))',
    `    if [ "$topo_statusline_elapsed" -ge 0 ] && [ "$topo_statusline_elapsed" -lt ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} ]; then`,
    '      exit 0',
    '    fi',
    '  fi',
    'fi',
    'if [ -n "$topo_statusline_now" ]; then',
    '  printf \'%s\' "$topo_statusline_now" >"$topo_statusline_stamp" 2>/dev/null || :',
    'fi',
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${TOPO_AGENT_HOOK_PORT}${CLAUDE_STATUSLINE_PATHNAME}" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Topo-Agent-Hook-Token: ${TOPO_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${TOPO_PANE_KEY}" \\',
    '  --data-urlencode "configDir=${CLAUDE_CONFIG_DIR}" \\',
    '  --data-urlencode "env=${TOPO_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${TOPO_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || true',
    'exit 0',
    ''
  ].join('\n')
}
