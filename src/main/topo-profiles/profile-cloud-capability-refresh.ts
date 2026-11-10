import type { RefreshCurrentTopoProfileAuthResult } from '../../shared/topo-profiles'
import { getTopoCloudAuthConfig, isTopoCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getTopoProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshTopoCloudCapabilities } from './profile-cloud-client'
import { ensureActiveTopoProfile } from './profile-index-store'
import { refreshDevTopoCloudProfile } from './profile-cloud-dev-service'
import {
  commitCloudSessionCapabilities,
  takeCloudSessionTicket,
  type CloudSessionTicket
} from './profile-cloud-session-owner'
import { runWithFreshTopoCloudSession } from './profile-cloud-session-refresh'

export async function refreshCurrentTopoProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentTopoProfileAuthResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  const auth = () => getTopoProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isTopoCloudDevAuthEnabled()) {
    const result = refreshDevTopoCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const cloud = active.profile.cloud
    let ticket: CloudSessionTicket | undefined
    const operation = await runWithFreshTopoCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => {
        // Take the ticket after refresh because refreshing may relink the session.
        ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
        return refreshTopoCloudCapabilities(configState.config, session)
      }
    )
    if (operation.status !== 'ok' || !ticket) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (
      refresh.cloud &&
      (refresh.cloud.userId !== cloud.userId ||
        refresh.cloud.cloudProfileId !== cloud.cloudProfileId)
    ) {
      throw new Error('topo_cloud_identity_changed_during_capability_refresh')
    }
    const list = commitCloudSessionCapabilities(active.profile.id, userDataPath, ticket, refresh)
    if (!list) {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: getTopoProfileAuthStatusFromProfile(
        ensureActiveTopoProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
