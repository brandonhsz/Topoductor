import './constants'
import { TOPO_BROWSER_PARTITION } from './browser/browser-session-partition'
import type { ExecutionHostId } from './execution-host'

export const TOPO_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_TOPO_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_TOPO_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'topoProfiles:authStatusChanged'
export const TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL = 'topoProfiles:signInProgressChanged'
const LEGACY_TOPO_BROWSER_SESSION_PARTITION_PREFIX = 'persist:topo-browser-session-'

export type TopoProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type TopoProfileKind = 'local' | 'cloud-linked'

export type TopoProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type TopoCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type TopoCloudCapabilityFlags = Record<string, boolean>

export type TopoCloudCapabilities = {
  flags: TopoCloudCapabilityFlags
  refreshedAt: number
}

export type TopoCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type TopoProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type TopoProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: TopoProfileAuthState
  persistence: TopoCloudSessionPersistence
  cloud?: TopoProfileCloudSummary
  organizations?: TopoCloudOrgSummary[]
  capabilities?: TopoCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type TopoProfileSummary = {
  id: string
  name: string
  avatar: TopoProfileAvatar
  kind: TopoProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: TopoProfileCloudSummary
}

export type TopoProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: TopoProfileSummary[]
}

export type TopoProfileListState = {
  activeProfileId: string
  profiles: TopoProfileSummary[]
}

export type TopoProfileListResult = TopoProfileListState & {
  // Gate the multi-profile switcher; default builds use one-profile account menus.
  multiProfileUi: boolean
}

export type CreateLocalTopoProfileArgs = {
  name?: string
}

export type CreateLocalTopoProfileResult = TopoProfileListState & {
  profile: TopoProfileSummary
}

export type CreateCloudLinkedTopoProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchTopoProfileArgs = {
  profileId: string
}

export type SwitchTopoProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferTopoProfileProjectMode = 'move' | 'copy'

export type TransferTopoProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferTopoProfileProjectMode
}

export type FindTopoProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type TopoProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: TopoProfileKind
  repoId: string
  repoName: string
}

export type FindTopoProfileProjectsByPathResult = {
  projects: TopoProfileProjectPresence[]
}

export type TransferTopoProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferTopoProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

/** A sign-in in flight; `link` is set only while the browser has not answered yet. */
export type TopoCloudSignInProgress = { link: string | null }

export type ConnectCurrentTopoProfileResult =
  | {
      status: 'connected'
      auth: TopoProfileAuthStatus
      activeProfileId: string
      profiles: TopoProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'timed-out'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: TopoProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedTopoProfileResult =
  | {
      status: 'created'
      auth: TopoProfileAuthStatus
      activeProfileId: string
      profiles: TopoProfileSummary[]
      profile: TopoProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: TopoProfileAuthStatus
      error: string
    }

export type SignOutCurrentTopoProfileResult = {
  status: 'signed-out'
  auth: TopoProfileAuthStatus
  activeProfileId: string
  profiles: TopoProfileSummary[]
}

export type SelectTopoProfileOrgArgs = {
  orgId: string
}

export type SelectTopoProfileOrgResult =
  | {
      status: 'selected'
      auth: TopoProfileAuthStatus
      activeProfileId: string
      profiles: TopoProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: TopoProfileAuthStatus
      error: string
    }

export type RefreshCurrentTopoProfileAuthResult =
  | {
      status: 'refreshed'
      auth: TopoProfileAuthStatus
      activeProfileId: string
      profiles: TopoProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: TopoProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: TopoProfileAuthStatus
      error: string
    }

// Mirror the server’s fixed role enum so UI options cannot drift from accepted API values.
export type TopoOrgRole = 'owner' | 'admin' | 'member'

export type TopoOrgMember = {
  // Provisioned teammates without sign-in have no userId; disable mutations requiring that key.
  userId: string | null
  email: string
  displayName?: string
  role: TopoOrgRole
}

export type TopoOrgPendingInvite = {
  email: string
  role: TopoOrgRole
  createdAt: number
}

export type TopoOrgMembersRoster = {
  members: TopoOrgMember[]
  pendingInvites: TopoOrgPendingInvite[]
  viewerRole: TopoOrgRole
  canManageMembers: boolean
}

export type TopoProfileOrgMembersListArgs = {
  orgId: string
}

export type TopoProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: TopoOrgRole
}

export type TopoProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type TopoProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: TopoOrgRole
}

export type TopoProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type TopoProfileOrgMembersListResult =
  | { status: 'ok'; roster: TopoOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type TopoOrgInviteConflictReason = 'already_member' | 'already_invited'
export type TopoOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type TopoProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: TopoOrgInviteConflictReason }
  | { status: 'invalid'; reason: TopoOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalTopoProfile(now: number): TopoProfileSummary {
  return {
    id: DEFAULT_LOCAL_TOPO_PROFILE_ID,
    name: DEFAULT_LOCAL_TOPO_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getTopoProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getTopoProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_TOPO_PROFILE_ID) {
    return TOPO_BROWSER_PARTITION
  }
  return `persist:topo-profile-${getTopoProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getTopoProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_TOPO_PROFILE_ID) {
    return `${LEGACY_TOPO_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:topo-profile-${getTopoProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
