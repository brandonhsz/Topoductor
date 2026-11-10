import { describe, expect, it } from 'vitest'
import { parseTopoBrowserCommand } from './topo-browser-cli-commands'

describe('parseTopoBrowserCommand', () => {
  it.each([
    'topo worktree ls',
    'topo terminal send --text "topo click"',
    'topostra click',
    'topo',
    'echo topo click',
    'echo "docs; topo snapshot --page p1; text"',
    "git commit -m 'run topo click | topo snapshot'",
    'git log --oneline'
  ])('does not match %s', (command) => {
    expect(parseTopoBrowserCommand(command)).toBeNull()
  })
})
