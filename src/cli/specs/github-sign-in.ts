import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const GITHUB_SIGN_IN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['github', 'login'],
    summary: "Sign the host's gh in to GitHub with a device code",
    usage: 'topo github login [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Runs `gh auth login` on the target host and prints the github.com/login/device page and one-time code to open on this device.',
      'Also runs `gh auth setup-git`, so git over https on that host uses the new login.',
      'The token stays in that host’s gh keyring; GH_TOKEN/GITHUB_TOKEN in the host environment still override it.'
    ],
    examples: ['topo github login --environment Topoductor']
  }
]
