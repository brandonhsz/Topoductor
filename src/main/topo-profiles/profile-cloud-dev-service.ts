import type {
  CreateCloudLinkedTopoProfileArgs,
  TopoProfileListState
} from '../../shared/topo-profiles'
import type { ActiveTopoProfileState } from './profile-index-store'
import { createCloudLinkedTopoProfileRecord, linkTopoProfileToCloud } from './profile-cloud-index'
import { readCloudSession, signInCloudSession } from './profile-cloud-session-owner'
import { createDevTopoCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = TopoProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedTopoProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevTopoCloudProfile(
  active: ActiveTopoProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevTopoCloudSession({ localProfileId: active.profile.id })
  signInCloudSession(active.profile.id, userDataPath, session)
  return linkTopoProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedTopoProfile(
  active: ActiveTopoProfileState,
  userDataPath: string,
  args: CreateCloudLinkedTopoProfileArgs
): DevCreateProfileResult {
  if (readCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevTopoCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedTopoProfileRecord(session.cloud, { name: args.name }, userDataPath)
  signInCloudSession(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevTopoCloudProfile(
  active: ActiveTopoProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevTopoCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkTopoProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevTopoCloudOrg(
  active: ActiveTopoProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevTopoCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkTopoProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
