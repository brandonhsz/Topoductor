import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AVENAPM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['avenapm', 'queue'],
    summary: 'List tickets of the AvenaPM operation queue',
    usage:
      'topo avenapm queue [--status por_hacer|en_progreso|en_revision|terminado|archivado] [--unassigned] [--require-any] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'status', 'unassigned', 'require-any'],
    notes: [
      'Uses the AvenaPM account connected in Topo settings.',
      '--require-any exits with status 1 when no ticket matches, so an automation precheck can skip the run.'
    ],
    examples: [
      'topo avenapm queue --status por_hacer --unassigned',
      'topo avenapm queue --status por_hacer --unassigned --require-any'
    ]
  }
]
