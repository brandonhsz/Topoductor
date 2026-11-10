/** Set by `topo serve` on its topod child: '1' when a service manager supervises it, '' otherwise. */
export const TOPO_SERVE_SUPERVISED_ENV = 'TOPO_SERVE_SUPERVISED'

/** EX_TEMPFAIL: a supervised topod had no terminal daemon, so its terminals would die on restart. */
export const TOPOD_EXIT_TERMINALS_NOT_DURABLE = 75
