import type {
  TopoCloudSignInProgress,
  ConnectCurrentTopoProfileResult,
  CreateCloudLinkedTopoProfileArgs,
  CreateCloudLinkedTopoProfileResult,
  CreateLocalTopoProfileArgs,
  CreateLocalTopoProfileResult,
  FindTopoProfileProjectsByPathArgs,
  FindTopoProfileProjectsByPathResult,
  TopoProfileAuthStatus,
  TopoProfileListResult,
  TopoProfileOrgInviteRevokeArgs,
  TopoProfileOrgMemberChangeRoleArgs,
  TopoProfileOrgMemberInviteArgs,
  TopoProfileOrgMemberMutationResult,
  TopoProfileOrgMemberRemoveArgs,
  TopoProfileOrgMembersListArgs,
  TopoProfileOrgMembersListResult,
  RefreshCurrentTopoProfileAuthResult,
  SelectTopoProfileOrgArgs,
  SelectTopoProfileOrgResult,
  SignOutCurrentTopoProfileResult,
  SwitchTopoProfileArgs,
  SwitchTopoProfileResult,
  TransferTopoProfileProjectArgs,
  TransferTopoProfileProjectResult
} from '../../shared/topo-profiles'

export type TopoProfileApi = {
  list: () => Promise<TopoProfileListResult>
  authStatus: () => Promise<TopoProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalTopoProfileArgs) => Promise<CreateLocalTopoProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedTopoProfileArgs
  ) => Promise<CreateCloudLinkedTopoProfileResult>
  switchProfile: (args: SwitchTopoProfileArgs) => Promise<SwitchTopoProfileResult>
  transferProject: (
    args: TransferTopoProfileProjectArgs
  ) => Promise<TransferTopoProfileProjectResult>
  findProjectProfiles: (
    args: FindTopoProfileProjectsByPathArgs
  ) => Promise<FindTopoProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentTopoProfileResult>
  signInProgress: () => Promise<TopoCloudSignInProgress | null>
  onSignInProgressChanged: (
    callback: (progress: TopoCloudSignInProgress | null) => void
  ) => () => void
  cancelSignIn: () => Promise<void>
  refreshAuth: () => Promise<RefreshCurrentTopoProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentTopoProfileResult>
  selectOrg: (args: SelectTopoProfileOrgArgs) => Promise<SelectTopoProfileOrgResult>
  orgMembersList: (args: TopoProfileOrgMembersListArgs) => Promise<TopoProfileOrgMembersListResult>
  orgMemberInvite: (
    args: TopoProfileOrgMemberInviteArgs
  ) => Promise<TopoProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: TopoProfileOrgInviteRevokeArgs
  ) => Promise<TopoProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: TopoProfileOrgMemberChangeRoleArgs
  ) => Promise<TopoProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: TopoProfileOrgMemberRemoveArgs
  ) => Promise<TopoProfileOrgMemberMutationResult>
}
