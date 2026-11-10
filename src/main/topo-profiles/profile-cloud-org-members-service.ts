import type {
  TopoProfileOrgInviteRevokeArgs,
  TopoProfileOrgMemberChangeRoleArgs,
  TopoProfileOrgMemberInviteArgs,
  TopoProfileOrgMemberMutationResult,
  TopoProfileOrgMemberRemoveArgs,
  TopoProfileOrgMembersListResult
} from '../../shared/topo-profiles'
import type { ActiveTopoProfileState } from './profile-index-store'
import { ensureActiveTopoProfile } from './profile-index-store'
import type { TopoCloudAuthConfig } from './profile-cloud-auth-config'
import { getTopoCloudAuthConfig, isTopoCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { TopoCloudSession } from './profile-cloud-session-store'
import { TopoCloudRequestError } from './profile-cloud-client'
import { runWithFreshTopoCloudSession } from './profile-cloud-session-refresh'
import {
  changeTopoCloudOrgMemberRole,
  inviteTopoCloudOrgMember,
  listTopoCloudOrgMembers,
  removeTopoCloudOrgMember,
  revokeTopoCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevTopoCloudOrgMemberRole,
  inviteDevTopoCloudOrgMember,
  listDevTopoCloudOrgMembers,
  removeDevTopoCloudOrgMember,
  revokeDevTopoCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: TopoCloudRequestError }
  | { status: 'failed'; error: string }

// Only 401 should trigger session refresh; return business/permission failures as values.
async function runOrgMemberCall<T>(
  config: TopoCloudAuthConfig,
  active: ActiveTopoProfileState,
  userDataPath: string,
  call: (session: TopoCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshTopoCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof TopoCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(error: TopoCloudRequestError): TopoProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): TopoProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listTopoProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<TopoProfileOrgMembersListResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevTopoCloudOrgMembers(orgId) }
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listTopoCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteTopoProfileOrgMember(
  userDataPath: string,
  args: TopoProfileOrgMemberInviteArgs
): Promise<TopoProfileOrgMemberMutationResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    return inviteDevTopoCloudOrgMember(args)
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteTopoCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeTopoProfileOrgInvite(
  userDataPath: string,
  args: TopoProfileOrgInviteRevokeArgs
): Promise<TopoProfileOrgMemberMutationResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    return revokeDevTopoCloudOrgInvite(args)
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeTopoCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeTopoProfileOrgMemberRole(
  userDataPath: string,
  args: TopoProfileOrgMemberChangeRoleArgs
): Promise<TopoProfileOrgMemberMutationResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    return changeDevTopoCloudOrgMemberRole(args)
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeTopoCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeTopoProfileOrgMember(
  userDataPath: string,
  args: TopoProfileOrgMemberRemoveArgs
): Promise<TopoProfileOrgMemberMutationResult> {
  const active = ensureActiveTopoProfile(userDataPath)
  if (isTopoCloudDevAuthEnabled()) {
    return removeDevTopoCloudOrgMember(args)
  }
  const configState = getTopoCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeTopoCloudOrgMember(configState.config, session, args)
    )
  )
}
