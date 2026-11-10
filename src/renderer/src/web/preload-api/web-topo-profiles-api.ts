import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_TOPO_PROFILE_ID,
  createDefaultLocalTopoProfile
} from '../../../../shared/topo-profiles'
import { noopUnsubscribe } from './web-storage'

export function createWebTopoProfilesApi(): Partial<PreloadApi> {
  const webTopoProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_TOPO_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Topo Cloud sign-in is not available in the browser fallback.'
    })
  return {
    topoProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_TOPO_PROFILE_ID,
          profiles: [createDefaultLocalTopoProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webTopoProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      onSignInProgressChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_TOPO_PROFILE_ID,
          profiles: [createDefaultLocalTopoProfile(0)],
          profile: createDefaultLocalTopoProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webTopoProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webTopoProfileAuthStatus()
      }),
      signInProgress: async () => null,
      cancelSignIn: async () => {},
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webTopoProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webTopoProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_TOPO_PROFILE_ID,
        profiles: [createDefaultLocalTopoProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webTopoProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
