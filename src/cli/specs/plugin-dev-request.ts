import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** `topo plugin dev hook`; listed in PLUGIN_RUNTIME_COMMAND_SPECS. */
export const PLUGIN_DEV_HOOK_COMMAND_SPEC: CommandSpec = {
  path: ['plugin', 'dev', 'hook'],
  summary: "Run a hook through a development plugin's worker and print what the chain decided",
  usage: 'topo plugin dev hook <dir|plugin-key> <hook> --data <json> [--json]',
  allowedFlags: [...GLOBAL_FLAGS, 'target', 'event', 'data'],
  positionalArgs: ['target', 'event'],
  notes: [
    "Runs the worker's `orca.hooks.on` handlers with that plugin as the only one in the chain, under the same deadline and checks as a real hook; nothing in Topo acts on the result. The plugin must be an approved development plugin listing the hook in contributes.hooks.",
    "--data is the hook's event as JSON (the host API reference lists them). Prints `{ pluginKey, event, decision }`, where decision is `{ kind: 'continue', event }` or `{ kind: 'deny', reason }`. A timeout or throw counts as passing and shows in `topo plugin logs`."
  ],
  examples: [
    'topo plugin dev hook . terminal.send --data \'{"terminalId":"t1","text":"rm -rf /","enter":true,"inputKind":"driving"}\''
  ]
}

/** `topo plugin dev request`; listed in PLUGIN_RUNTIME_COMMAND_SPECS. */
export const PLUGIN_DEV_REQUEST_COMMAND_SPEC: CommandSpec = {
  path: ['plugin', 'dev', 'request'],
  summary: "Call a development plugin's worker handler the way a panel's plugin.request does",
  usage:
    'topo plugin dev request <dir|plugin-key> <name> [--data <json>] [--panel <id>] [--timeout-ms <ms>] [--json]',
  allowedFlags: [...GLOBAL_FLAGS, 'target', 'name', 'data', 'panel', 'timeout-ms'],
  positionalArgs: ['target', 'name'],
  notes: [
    "Runs the handler the worker registered with `orca.panels.handle(name, …)` through the same bridge an open panel's `plugin.request` uses: the plugin must be an approved development plugin with `main`, and its worker starts if it is not running.",
    '--data is the input as JSON; without it the handler gets null, as `plugin.request(name)` sends. --panel sets the caller panel id the handler sees (default `topo-cli`); --timeout-ms is how long the handler may take (default 30000, at most 120000).',
    "Prints `{ pluginKey, name, result }`. A handler error fails with `plugin_request_failed` and the worker's code in `requestCode` (`unknown_method` when nothing handles the name, `timeout`, `unavailable`, or the code the handler threw).",
    'Installed plugins are refused; load the folder with `topo plugin dev load` first.'
  ],
  examples: [
    'topo plugin dev request . count --data \'{"by":1}\'',
    'topo plugin dev request acme.notes notes.list --json'
  ]
}
