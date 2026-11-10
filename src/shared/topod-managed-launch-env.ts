/** Managed launches alone enable idle exit and name the activation fence that keeps updates/rollbacks alive.
 * Dependency-free so the topod launcher can read it. */
export const TOPOD_MANAGED_ACTIVATION_ROOT_ENV = 'TOPO_TOPOD_MANAGED_ACTIVATION_ROOT'

/** Host login env naming a machine's own managed-server data on a shared home; clones copy /etc/machine-id. */
export const TOPO_MACHINE_NAME_ENV = 'TOPO_MACHINE_NAME'
