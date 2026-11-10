export const TOPOD_PAIRING_REPAIR_FAILED_CODE = 'topod_pairing_repair_failed'

export class TopodManagedPairingRepairFailedError extends Error {
  readonly code = TOPOD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${TOPOD_PAIRING_REPAIR_FAILED_CODE}: the Topo server on this host no longer accepts this ` +
        `computer, and Topo couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until Topo pairs again. Connect again to retry.`
    )
    this.name = 'TopodManagedPairingRepairFailedError'
  }
}
