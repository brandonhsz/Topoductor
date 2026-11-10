import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

const SELECTOR_NOTE =
  '--environment names a managed Topo server this machine deployed over SSH (see `topo environment list`); it is a selector here, not a routing flag.'
const DESKTOP_NOTE =
  'Runs on this machine’s Topo desktop app, the same action as Settings > Topo on your SSH hosts. A runtime without the SSH registry (headless `topo serve`) refuses it.'

export const MANAGED_SERVER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['environment', 'status'],
    summary: 'Show a managed Topo server’s active version, terminals and pending work',
    usage: 'topo environment status --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE],
    examples: ['topo environment status --environment build-box']
  },
  {
    path: ['environment', 'update'],
    summary: 'Update a managed Topo server to this build’s version',
    usage: 'topo environment update --environment <selector> [--force] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'force'],
    notes: [
      'Without --force, an update that would restart over running terminals is deferred and reported, not applied.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['topo environment update --environment build-box']
  },
  {
    path: ['environment', 'rollback'],
    destructive: true,
    summary: 'Roll a managed Topo server back to its previous version',
    usage: 'topo environment rollback --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  },
  {
    path: ['environment', 'recover'],
    summary: 'Finish or undo a managed Topo server’s interrupted update, rollback or stop',
    usage:
      'topo environment recover --environment <selector> [--accept-changed-state --yes] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'accept-changed-state', 'yes'],
    notes: [
      'When a rejected build changed profile state, recover refuses rather than restart the previous build over it. --accept-changed-state --yes restores the prelaunch snapshot instead, the same as Restore in Settings > Topo on your SSH hosts; what the rejected build changed is discarded.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [
      'topo environment recover --environment build-box',
      'topo environment recover --environment build-box --accept-changed-state --yes'
    ]
  },
  {
    path: ['environment', 'stop'],
    destructive: true,
    summary: 'Stop a managed Topo server and unlink it from this machine (decommission)',
    usage: 'topo environment stop --environment <selector> --yes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'yes'],
    notes: [
      'Stops topod on the SSH host and, once the host proves it exited, removes the server from this machine and disconnects the host. Its terminals end. Connecting the host again sets up a new server. Requires --yes.',
      'If the host cannot prove topod exited, the server stays linked and the refusal says why; nothing is removed on a guess. For a host that is gone for good, use `topo environment forget`.',
      'If this server is the default host for new projects, choose another one first. `topo environment cancel-stop` withdraws a stop topod has not acted on yet.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['topo environment stop --environment build-box --yes']
  },
  {
    path: ['environment', 'forget'],
    destructive: true,
    summary: 'Unlink a managed Topo server whose SSH host is gone, without stopping it',
    usage: 'topo environment forget --environment <selector> --yes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'yes'],
    notes: [
      'Removes the server from this machine without contacting its host, so the SSH host can then be removed. Use it when the host was deleted or can never be reached again. Requires --yes.',
      'Nothing on the host is stopped: if it comes back, topod may still be running there.',
      'The SSH host is left disconnected, since no Topo server serves it any more. Connecting it again (Connect in Topo) sets its server up again, relinking one still running there.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['topo environment forget --environment build-box --yes']
  },
  {
    path: ['environment', 'cancel-stop'],
    summary: 'Withdraw a managed Topo server stop that topod has not acted on yet',
    usage: 'topo environment cancel-stop --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  }
]
