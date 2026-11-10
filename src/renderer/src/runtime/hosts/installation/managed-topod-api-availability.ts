import type { ManagedTopodPreloadApi } from '../../../../../preload/api/managed-topod-api'
import { isWebClientLocation } from '@/lib/web-client-location'

/** Web fallback stubs cannot manage SSH hosts. */
export function getManagedTopodApi(): ManagedTopodPreloadApi | undefined {
  return isWebClientLocation() ? undefined : window.api.runtimeEnvironments.managedTopod
}
