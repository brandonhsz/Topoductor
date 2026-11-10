import type { TopoPushPayload } from './push-payload'

export type NativeDismissal = {
  rememberAll(payloads: readonly TopoPushPayload[]): Promise<void>
  wasDismissed(payload: TopoPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
