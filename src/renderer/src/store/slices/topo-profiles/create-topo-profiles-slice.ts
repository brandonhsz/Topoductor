import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  TopoCloudSignInProgress,
  TopoProfileAuthStatus,
  TopoProfileSummary,
  SwitchTopoProfileResult,
  TransferTopoProfileProjectArgs,
  TransferTopoProfileProjectResult
} from '../../../../../shared/topo-profiles'
import type { AppState } from '../../types'
import {
  createTopoProfilesAuthActions,
  type TopoProfilesAuthActions
} from './topo-profiles-auth-actions'

export type TopoProfilesSlice = TopoProfilesAuthActions & {
  topoProfiles: TopoProfileSummary[]
  activeTopoProfileId: string | null
  topoProfileAuthStatus: TopoProfileAuthStatus | null
  topoProfileSignInProgress: TopoCloudSignInProgress | null
  topoProfilesMultiProfileUi: boolean
  topoProfilesLoading: boolean
  topoProfileSwitching: boolean
  fetchTopoProfiles: () => Promise<void>
  fetchTopoProfileAuthStatus: () => Promise<TopoProfileAuthStatus | null>
  createLocalTopoProfile: (name?: string) => Promise<TopoProfileSummary | null>
  switchTopoProfile: (profileId: string) => Promise<SwitchTopoProfileResult | null>
  transferTopoProfileProject: (
    args: TransferTopoProfileProjectArgs
  ) => Promise<TransferTopoProfileProjectResult | null>
}

export const createTopoProfilesSlice: StateCreator<AppState, [], [], TopoProfilesSlice> = (
  set,
  get,
  api
) => ({
  topoProfiles: [],
  activeTopoProfileId: null,
  topoProfileAuthStatus: null,
  topoProfileSignInProgress: null,
  topoProfilesMultiProfileUi: false,
  topoProfilesLoading: false,
  topoProfileSwitching: false,

  fetchTopoProfiles: async () => {
    set({ topoProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.topoProfiles.list(),
        window.api.topoProfiles.authStatus()
      ])
      set({
        activeTopoProfileId: state.activeProfileId,
        topoProfiles: state.profiles,
        topoProfilesMultiProfileUi: state.multiProfileUi,
        topoProfileAuthStatus: authStatus,
        topoProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Topo profiles:', err)
      set({ topoProfilesLoading: false })
    }
  },

  fetchTopoProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.topoProfiles.authStatus()
      set({ topoProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Topo profile auth status:', err)
      return null
    }
  },

  createLocalTopoProfile: async (name) => {
    try {
      const state = await window.api.topoProfiles.createLocal({ name })
      set({
        activeTopoProfileId: state.activeProfileId,
        topoProfiles: state.profiles
      })
      void get().fetchTopoProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Topo profile:', err)
      toast.error(
        translate('auto.store.slices.topo.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createTopoProfilesAuthActions(set, get, api),

  switchTopoProfile: async (profileId) => {
    if (!profileId || profileId === get().activeTopoProfileId) {
      return { status: 'already-active' }
    }
    set({ topoProfileSwitching: true })
    try {
      const result = await window.api.topoProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Only actual relaunch locks switcher; stale already-active answers must unlock it.
        set({ topoProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Topo profile:', err)
      set({ topoProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.topo.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferTopoProfileProject: async (args) => {
    try {
      const result = await window.api.topoProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.topo.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ topoProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Topo profile project:', err)
      toast.error(
        translate('auto.store.slices.topo.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
