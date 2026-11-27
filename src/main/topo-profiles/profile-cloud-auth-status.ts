import type { TopoProfileAuthStatus } from '../../shared/topo-profiles'
import type { MobileRelayAuthStatus } from '../../shared/mobile-relay-availability'
import type { ActiveTopoProfileState } from './profile-index-store'
import { getTopoCloudAuthConfig, isTopoCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { readCloudSession } from './profile-cloud-session-owner'

export function getTopoProfileAuthStatusFromProfile(
  active: ActiveTopoProfileState,
  userDataPath: string
): MobileRelayAuthStatus {
  const configState = getTopoCloudAuthConfig()
  const status = cloudAuthStatus(active, userDataPath, configState)
  return configState.configured && configState.config.relayAuthMode === 'host-key'
    ? { ...status, relaySelfHosted: true }
    : status
}

function cloudAuthStatus(
  active: ActiveTopoProfileState,
  userDataPath: string,
  configState: ReturnType<typeof getTopoCloudAuthConfig>
): TopoProfileAuthStatus {
  const devAuthEnabled = isTopoCloudDevAuthEnabled()
  const configured = configState.configured || devAuthEnabled
  const cloud = active.profile.cloud
  if (!cloud) {
    return {
      activeProfileId: active.profile.id,
      configured,
      state: configured ? 'local' : 'unconfigured',
      persistence: 'none',
      setupMessage: configured ? undefined : configState.setupMessage
    }
  }

  const session = readCloudSession(active.profile.id, userDataPath)
  if (!configured) {
    return {
      activeProfileId: active.profile.id,
      configured: false,
      state: 'unconfigured',
      persistence: session.status === 'found' ? session.persistence : 'none',
      cloud,
      credentialError:
        session.status === 'decrypt-failed' || session.status === 'unreadable'
          ? session.error
          : undefined,
      setupMessage: configState.setupMessage
    }
  }
  if (session.status === 'found') {
    return {
      activeProfileId: active.profile.id,
      configured,
      state: 'connected',
      persistence: session.persistence,
      cloud,
      organizations: session.session.organizations,
      capabilities: session.session.capabilities
    }
  }

  return {
    activeProfileId: active.profile.id,
    configured,
    state: 'reconnect-required',
    persistence: 'none',
    cloud,
    credentialError:
      session.status === 'decrypt-failed' || session.status === 'unreadable'
        ? session.error
        : undefined
  }
}
