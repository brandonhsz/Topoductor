import { useLocalSearchParams } from 'expo-router'
import { MobileRemoteDesktopScreen } from '../../../src/remote-desktop/MobileRemoteDesktopScreen'
import { PageRouteUnavailableScreen } from '../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { firstParam } from '../../../src/navigation/route-param-reader'

export default function MobileRemoteDesktopRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  if (!hostId) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  // Remount on host change so no session outlives its host.
  return <MobileRemoteDesktopScreen key={hostId} hostId={hostId} />
}
