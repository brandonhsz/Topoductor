import type { AgentHookSource } from '../../../../shared/agent-hook-listener/transport/agent-hook-relay'

/** Extra form lines precede payload@- and must end with ` ^`. */
export function buildWindowsAgentHookPostCommand(
  source: AgentHookSource,
  extraFormLines: readonly string[] = []
): string {
  // Avoid PowerShell startup; qualify curl to prevent repo-local payload interception.
  return [
    `"%SystemRoot%\\System32\\curl.exe" -sS -X POST "http://127.0.0.1:%TOPO_AGENT_HOOK_PORT%/hook/${source}" ^`,
    '  --connect-timeout 0.5 --max-time 1.5 ^',
    '  -H "Content-Type: application/x-www-form-urlencoded" ^',
    '  -H "X-Topo-Agent-Hook-Token: %TOPO_AGENT_HOOK_TOKEN%" ^',
    '  --data-urlencode "paneKey=%TOPO_PANE_KEY%" ^',
    '  --data-urlencode "tabId=%TOPO_TAB_ID%" ^',
    '  --data-urlencode "launchToken=%TOPO_AGENT_LAUNCH_TOKEN%" ^',
    '  --data-urlencode "worktreeId=%TOPO_WORKTREE_ID%" ^',
    '  --data-urlencode "env=%TOPO_AGENT_HOOK_ENV%" ^',
    '  --data-urlencode "version=%TOPO_AGENT_HOOK_VERSION%" ^',
    ...extraFormLines,
    '  --data-urlencode "payload@-" >nul 2>nul'
  ].join('\r\n')
}

// curl.exe avoids PowerShell startup and code-page corruption of UTF-8 payloads.
export function buildWindowsAgentHookCurlPostCommand(source: AgentHookSource): string {
  return [
    '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
    `"http://127.0.0.1:%TOPO_AGENT_HOOK_PORT%/hook/${source}"`,
    '--connect-timeout 0.5 --max-time 1.5',
    '-H "Content-Type: application/x-www-form-urlencoded"',
    '-H "X-Topo-Agent-Hook-Token: %TOPO_AGENT_HOOK_TOKEN%"',
    '--data-urlencode "paneKey=%TOPO_PANE_KEY%"',
    '--data-urlencode "tabId=%TOPO_TAB_ID%"',
    '--data-urlencode "launchToken=%TOPO_AGENT_LAUNCH_TOKEN%"',
    '--data-urlencode "worktreeId=%TOPO_WORKTREE_ID%"',
    '--data-urlencode "env=%TOPO_AGENT_HOOK_ENV%"',
    '--data-urlencode "version=%TOPO_AGENT_HOOK_VERSION%"',
    '--data-urlencode "payload@-"',
    '>nul 2>&1'
  ].join(' ')
}
