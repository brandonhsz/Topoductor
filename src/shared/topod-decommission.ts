import type { TopodManagedRefusal } from './topod-managed-runtime'
import type { TopodDaemonRetirementVerdict } from './topod-stop-request'

export type TopodDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: TopodDaemonRetirementVerdict
    }
  | TopodManagedRefusal
