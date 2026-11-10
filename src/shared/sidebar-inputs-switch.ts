// Gate main-owned sidebar producers and feed domains on TOPO_SIDEBAR_INPUTS_IS_MAIN; off in shipped builds.
// Instantiate producers conditionally so switch-off builds drop them; register RPCs in SIDEBAR_INPUT_METHODS
// and domains in sidebar-inputs-feed-domains.ts.

/** Substituted by electron.vite.config.ts; absent (off) in tests, the CLI and the web client. */
declare const TOPO_SIDEBAR_INPUTS: 'window' | 'main' | undefined

export const TOPO_SIDEBAR_INPUTS_IS_MAIN =
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- undeclared outside electron-vite builds; a bare read throws.
  typeof TOPO_SIDEBAR_INPUTS !== 'undefined' && TOPO_SIDEBAR_INPUTS === 'main'
