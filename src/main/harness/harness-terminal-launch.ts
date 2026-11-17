import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { withCodexArgs } from '../../shared/agent-launch/startup/tui-agent-launch-command'
import type { AgentStartupShell } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { withClaudeOption } from '../../shared/claude-plugin-dir-launch'
import { getHarnessRunService } from './harness-run-registry'

/** Terminal agents get the Harness flow as system instructions: Claude from a file, Codex as config. */
export async function applyHarnessToTerminalLaunch(args: {
  agent: TuiAgent
  worktreeId: string
  paneKey: string | null
  userDataPath: string
  command: string
  shell: AgentStartupShell
}): Promise<string> {
  const isClaude = args.agent === 'claude' || args.agent === 'claude-agent-teams'
  if (!isClaude && args.agent !== 'codex') {
    return args.command
  }
  const instructions = getHarnessRunService()?.chatInstructions(
    args.worktreeId,
    `terminal:${args.paneKey ?? args.worktreeId}`
  )
  if (!instructions) {
    return args.command
  }
  if (args.agent === 'codex') {
    return withCodexArgs(
      args.command,
      ['-c', `developer_instructions=${JSON.stringify(instructions)}`],
      args.shell
    )
  }
  const folder = join(args.userDataPath, 'harness-instructions')
  const file = join(
    folder,
    `${createHash('sha256').update(args.worktreeId).digest('hex').slice(0, 16)}.md`
  )
  await mkdir(folder, { recursive: true })
  await writeFile(file, instructions, 'utf8')
  return withClaudeOption(args.command, '--append-system-prompt-file', file, args.shell)
}
