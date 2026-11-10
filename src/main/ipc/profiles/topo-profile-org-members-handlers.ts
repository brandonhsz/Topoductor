import { ipcMain } from 'electron'
import type {
  TopoOrgRole,
  TopoProfileOrgInviteRevokeArgs,
  TopoProfileOrgMemberChangeRoleArgs,
  TopoProfileOrgMemberInviteArgs,
  TopoProfileOrgMemberMutationResult,
  TopoProfileOrgMemberRemoveArgs,
  TopoProfileOrgMembersListArgs,
  TopoProfileOrgMembersListResult
} from '../../../shared/topo-profiles'
import { getProfileUserDataPath } from '../../topo-profiles/profile-storage-paths'
import {
  changeTopoProfileOrgMemberRole,
  inviteTopoProfileOrgMember,
  listTopoProfileOrgMembers,
  removeTopoProfileOrgMember,
  revokeTopoProfileOrgInvite
} from '../../topo-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_topo_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_topo_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): TopoOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_topo_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_topo_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_topo_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): TopoProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): TopoProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): TopoProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): TopoProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerTopoProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'topoProfiles:orgMembersList',
    async (
      _event,
      rawArgs: TopoProfileOrgMembersListArgs
    ): Promise<TopoProfileOrgMembersListResult> =>
      listTopoProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'topoProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: TopoProfileOrgMemberInviteArgs
    ): Promise<TopoProfileOrgMemberMutationResult> =>
      inviteTopoProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'topoProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: TopoProfileOrgInviteRevokeArgs
    ): Promise<TopoProfileOrgMemberMutationResult> =>
      revokeTopoProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'topoProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: TopoProfileOrgMemberChangeRoleArgs
    ): Promise<TopoProfileOrgMemberMutationResult> =>
      changeTopoProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'topoProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: TopoProfileOrgMemberRemoveArgs
    ): Promise<TopoProfileOrgMemberMutationResult> =>
      removeTopoProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
