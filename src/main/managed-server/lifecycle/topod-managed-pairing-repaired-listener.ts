let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedTopodPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedTopodPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
