import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentTopoProfileResult,
  CreateCloudLinkedTopoProfileResult,
  RefreshCurrentTopoProfileAuthResult,
  SelectTopoProfileOrgResult,
  SignOutCurrentTopoProfileResult
} from '../../../../../shared/topo-profiles'
import type { AppState } from '../../types'

export type TopoProfilesAuthActions = {
  createCloudLinkedTopoProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedTopoProfileResult | null>
  connectCurrentTopoProfile: () => Promise<ConnectCurrentTopoProfileResult | null>
  refreshCurrentTopoProfileAuth: () => Promise<RefreshCurrentTopoProfileAuthResult | null>
  signOutCurrentTopoProfile: () => Promise<SignOutCurrentTopoProfileResult | null>
  selectTopoProfileOrg: (orgId: string) => Promise<SelectTopoProfileOrgResult | null>
}

export const createTopoProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  TopoProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedTopoProfile: async (args) => {
      try {
        const result = await window.api.topoProfiles.createCloudLinked(args)
        set({
          topoProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeTopoProfileId: result.activeProfileId,
                topoProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.topo.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.topo.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.topo.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create Topo cloud profile:', err)
        toast.error(
          translate('auto.store.slices.topo.profiles.f0c9e11a6d', 'Failed to create cloud profile'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentTopoProfile: async () => {
      const attempt = ++nextConnectAttempt
      try {
        // Pending PKCE must not block retry; newer linked waits supersede older callbacks.
        const result = await window.api.topoProfiles.connectCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().topoProfileAuthStatus?.state === 'connected'
        set({
          topoProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeTopoProfileId: result.activeProfileId,
                topoProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.topo.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.topo.profiles.8b8fa73174',
              'Topo Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (result.status === 'timed-out' && !alreadyConnected) {
          toast.error(
            translate('auto.store.slices.topo.profiles.signInTimedOut', 'Sign-in timed out')
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.topo.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect Topo profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().topoProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.topo.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentTopoProfileAuth: async () => {
      try {
        const result = await window.api.topoProfiles.refreshAuth()
        set({
          topoProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeTopoProfileId: result.activeProfileId,
                topoProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.topo.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.topo.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh Topo profile auth:', err)
        toast.error(
          translate('auto.store.slices.topo.profiles.2f6c78a039', 'Failed to refresh profile auth'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentTopoProfile: async () => {
      nextConnectAttempt += 1
      appliedConnectAttempt = nextConnectAttempt
      try {
        const result = await window.api.topoProfiles.signOutCurrent()
        set({
          activeTopoProfileId: result.activeProfileId,
          topoProfiles: result.profiles,
          topoProfileAuthStatus: result.auth
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.topo.profiles.a37b5e6d37', 'Signed out of profile')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of Topo profile:', err)
        toast.error(translate('auto.store.slices.topo.profiles.83600521e7', 'Failed to sign out'), {
          description: err instanceof Error ? err.message : String(err)
        })
        return null
      }
    },

    selectTopoProfileOrg: async (orgId) => {
      try {
        const result = await window.api.topoProfiles.selectOrg({ orgId })
        set({
          topoProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeTopoProfileId: result.activeProfileId,
                topoProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.topo.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.topo.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch Topo profile org:', err)
        toast.error(
          translate('auto.store.slices.topo.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
