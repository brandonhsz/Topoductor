// No `node:module` import here: `topo plugin test` loads this on Node 20.6, which has no registerHooks.

export const isTopoSpecifier = (specifier: string): boolean =>
  specifier === 'orca' || specifier.startsWith('orca/')

/** Why a worker cannot import `orca` at run time; `topo plugin test` says the same. */
export function pluginWorkerTopoImportMessage(specifier: string): string {
  return `cannot import "${specifier}" at run time: it only provides types. Write \`import type { OrcaWorkerApi } from 'orca/worker'\` and use the \`orca\` object passed to activate(orca).`
}
