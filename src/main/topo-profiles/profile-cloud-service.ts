import type {
  ConnectCurrentTopoProfileResult,
  CreateCloudLinkedTopoProfileArgs,
  CreateCloudLinkedTopoProfileResult,
  TopoProfileAuthStatus,
  SelectTopoProfileOrgResult,
  SignOutCurrentTopoProfileResult
} from '../../shared/topo-profiles'
import { ensureActiveTopoProfile } from './profile-index-store'
import { getTopoCloudAuthConfig, isTopoCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  invalidateCloudSessionChanges,
  readCloudSession,
  signInCloudSession,
  signOutCloudSession
} from './profile-cloud-session-owner'
import {
  createTopoCloudProfile,
  exchangeTopoCloudAuthCode,
  revokeTopoCloudSession
} from './profile-cloud-client'
import { beginTopoCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedTopoProfileRecord,
  linkTopoProfileToCloud,
  unlinkTopoProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshTopoCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevTopoCloudProfile,
  createDevCloudLinkedTopoProfile,
  selectDevTopoCloudOrg
} from './profile-cloud-dev-service'
import { getTopoProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from './profile-cloud-org-selection'
import {
  endTopoCloudSignInProgress,
  setTopoCloudSignInLink,
  startTopoCloudSignInProgress
} from './profile-cloud-sign-in-progress'
import { clearRelayRegionPreferenceCache } from '../runtime/mobile-cloud-relay/relay-region-preference'

export { refreshCurrentTopoProfileAuth } from './profile-cloud-capability-refresh'

let nextCloudConnectAttempt = 0
let linkedCloudConnectAttempt = 0

function invalidateOutstandingCloudConnectAttempts(): void {
  nextCloudConnectAttempt += 1
  linkedCloudConnectAttempt = nextCloudConnectAttempt
  endTopoCloudSignInProgress()
}

function activeAuth(
  active: ReturnType<typeof ensureActiveTopoProfile>,
  userDataPath: string
): TopoProfileAuthStatus {
  return getTopoProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentTopoProfileAuthStatus(userDataPath: string): TopoProfileAuthStatus {
  return getTopoProfileAuthStatusFromProfile(ensureActiveTopoProfile(userDataPath), userDataPath)
}

export async function connectCurrentTopoProfile(
  userDataPath: string
): Promise<ConnectCurrentTopoProfileResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    const list = connectDevTopoCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  const attempt = ++nextCloudConnectAttempt
  const browserWait = new AbortController()
  startTopoCloudSignInProgress(attempt, () => browserWait.abort())
  try {
    const code = await beginTopoCloudPkceFlow(configState.config, active.profile.id, {
      signal: browserWait.signal,
      onAuthorizeUrl: (link) => setTopoCloudSignInLink(attempt, link)
    })
    // The callback listener has closed, so its browser link is dead.
    setTopoCloudSignInLink(attempt, null)
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentTopoProfileAuthStatus(userDataPath)
      }
    }
    const exchange = await exchangeTopoCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentTopoProfileAuthStatus(userDataPath)
      }
    }
    signInCloudSession(active.profile.id, userDataPath, exchange)
    const list = linkTopoProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    linkedCloudConnectAttempt = attempt
    return {
      status: 'connected',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'topo_cloud_auth_timeout' && attempt === nextCloudConnectAttempt) {
      return {
        status: 'timed-out',
        auth: getCurrentTopoProfileAuthStatus(userDataPath)
      }
    }
    if (
      message === 'topo_cloud_auth_timeout' ||
      message === 'topo_cloud_auth_denied' ||
      message === 'topo_cloud_auth_cancelled'
    ) {
      return {
        status: 'cancelled',
        auth: getCurrentTopoProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      error: message
    }
  } finally {
    endTopoCloudSignInProgress(attempt)
  }
}

export async function signOutCurrentTopoProfile(
  userDataPath: string
): Promise<SignOutCurrentTopoProfileResult> {
  // Pending browser sign-ins must not relink after explicit sign-out.
  invalidateOutstandingCloudConnectAttempts()
  const signOutEpoch = linkedCloudConnectAttempt
  const active = ensureActiveTopoProfile(userDataPath)
  const configState = getTopoCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Fence before network I/O so in-flight refreshes cannot save after sign-out.
  invalidateCloudSessionChanges(active.profile.id, userDataPath)
  if (!isTopoCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeTopoCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (linkedCloudConnectAttempt > signOutEpoch) {
    const current = ensureActiveTopoProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkTopoProfileFromCloud(active.profile.id, userDataPath)
  try {
    clearRelayRegionPreferenceCache(userDataPath)
  } catch {
    // A leftover latency cache must not fail the sign-out itself.
  }
  return {
    status: 'signed-out',
    auth: getCurrentTopoProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedTopoProfile(
  userDataPath: string,
  args: CreateCloudLinkedTopoProfileArgs
): Promise<CreateCloudLinkedTopoProfileResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedTopoProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshTopoCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createTopoCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedTopoProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentTopoProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectTopoProfileOrgResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    const result = selectDevTopoCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentTopoProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
