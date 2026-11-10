import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const EXIT_CODES_NOTE =
  'Exit codes: 0 ok, 1 error, 3 approval is needed (approval_required or approval_stale).'

const SOURCE_NOTE =
  'Sources: a catalog id (publisher.id), owner/repo[@ref] on GitHub, any https:// or ssh:// Git URL or git@host:owner/repo.git, a GitHub or GitLab release, tag or tree page URL, or a folder path. Without a version Topo installs the newest version tag (vX.Y.Z), else the default branch, always pinned to the exact commit.'

const PRIVATE_NOTE =
  "Git runs on the Topo host with that host's own credentials (credential helper such as `gh auth setup-git`, Git Credential Manager or osxkeychain, or the SSH agent) and never prompts. A repository it cannot read fails with git_auth_failed, which names the host and how to sign Git in there. URLs carrying a username or token are refused."

const APPROVE_NOTE =
  'Content-only plugins (themes, icons, syntaxes, translations) install and enable without approval. Anything that runs code or acts in Topo fails with approval_required before anything is written; it lists what it would be granted, why, the publisher and repository, and the exact command to re-run with --approve <fingerprint>, which is bound to that plugin, version, files and access.'

export const PLUGIN_INSTALL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plugin', 'install'],
    summary: 'Install a plugin from a catalog, a Git repository or a folder',
    usage:
      'topo plugin install <publisher.id|owner/repo[@ref]|git-url|page-url|dir> [--ref <ref>] [--catalog <official|community|id|url>] [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'source', 'ref', 'catalog', 'approve'],
    positionalArgs: ['source'],
    notes: [
      SOURCE_NOTE,
      PRIVATE_NOTE,
      APPROVE_NOTE,
      'Plugins not from Topo’s official catalog also show their publisher (the repository owner) and source repository, so your user can decide whether to trust them.',
      '--catalog picks the catalog when more than one lists the id. A folder path is on the Topo host; with --environment pass it absolute.',
      EXIT_CODES_NOTE
    ],
    examples: [
      'topo plugin install acme.dusk-theme',
      'topo plugin install acme/orca-dusk-theme',
      'topo plugin install acme/notes-panel@v1.4.0 --json',
      'topo plugin install https://github.com/acme/notes-panel/releases/tag/v1.4.0',
      'topo plugin install git@github.com:acme/private-panel.git --approve ap1-…'
    ]
  },
  {
    path: ['plugin', 'update'],
    summary: 'Update one installed plugin, or all of them',
    usage: 'topo plugin update <plugin-key|--all> [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plugin', 'all', 'approve'],
    positionalArgs: ['plugin'],
    notes: [
      'Catalog installs move to the release their catalog offers now; Git installs from a version tag move to the newest version tag, from a branch to its newest commit; commit pins stay put; folder installs re-copy the folder.',
      'An update that asks for no new access, from the same repository, keeps its approval. One that grows access (new capabilities, a higher execution level, new commands, shortcuts or panels) or moves to another repository fails with approval_required and leaves the running version untouched.',
      '--all updates everything it can and exits 3 if any update waits on approval, with one --approve command per plugin.',
      PRIVATE_NOTE,
      EXIT_CODES_NOTE
    ],
    examples: [
      'topo plugin update acme.notes-panel',
      'topo plugin update --all --json',
      'topo plugin update acme.notes-panel --approve ap1-…'
    ]
  },
  {
    path: ['plugin', 'uninstall'],
    summary: 'Remove an installed plugin',
    usage: 'topo plugin uninstall <plugin-key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plugin'],
    positionalArgs: ['plugin'],
    notes: [
      'Never needs approval. Removes its files, approval and theme choices. Bundled plugins can only be disabled; development folders use `topo plugin dev unload`.'
    ],
    examples: ['topo plugin uninstall acme.notes-panel']
  },
  {
    path: ['plugin', 'catalog', 'list'],
    summary: 'List the plugin catalogs on the Topo host',
    usage: 'topo plugin catalog list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Topo’s official catalog is always present; the community catalog is added by default.'
    ],
    examples: ['topo plugin catalog list --json']
  },
  {
    path: ['plugin', 'catalog', 'add'],
    summary: 'Add a plugin catalog; needs --approve',
    usage:
      'topo plugin catalog add <owner/repo|git-url> [--ref <branch>] [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'source', 'ref', 'approve'],
    positionalArgs: ['source'],
    notes: [
      'A catalog decides which repositories Topo installs and auto-updates plugins from, so adding one fails with approval_required until re-run with --approve <fingerprint> for that exact URL and branch. Adding one that is already there only refreshes it.',
      '--ref defaults to main. Private catalogs use the Topo host’s Git credentials like installs do.',
      EXIT_CODES_NOTE
    ],
    examples: [
      'topo plugin catalog add acme/orca-catalog',
      'topo plugin catalog add git@gitlab.com:acme/catalog.git --approve cat1-…'
    ]
  },
  {
    path: ['plugin', 'catalog', 'rm'],
    aliases: [['plugin', 'catalog', 'remove']],
    destructive: true,
    summary: 'Remove a plugin catalog',
    usage: 'topo plugin catalog rm <id|name|url> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'catalog'],
    positionalArgs: ['catalog'],
    notes: [
      'Never needs approval. Plugins installed from it stay installed but no longer update. Topo’s official catalog cannot be removed.'
    ],
    examples: ['topo plugin catalog rm community']
  }
]
