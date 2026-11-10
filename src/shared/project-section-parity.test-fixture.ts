// Host answers both the desktop sidebar's and the phone's Project grouping tests run on.
import type { MobileProjectSectionCatalog } from './mobile-project-sections-contract'
import type { ExecutionHostId } from './execution-host'
import {
  projectHostSetupProjectionFromRepos,
  type ProjectHostSetupProjection
} from './project-host-setup-projection'
import type { Repo } from './repo-types'
import type { RuntimeClientTarget } from './runtime-client-target'

const topoRemote = {
  canonicalKey: 'github.com/brandonhsz/Topoductor',
  remoteName: 'origin',
  remoteUrl: 'git@github.com:brandonhsz/Topoductor.git'
}

function hostRepo(id: string, path: string, displayName = 'topo'): Repo {
  return {
    id,
    path,
    displayName,
    badgeColor: '#737373',
    addedAt: 1,
    ...(displayName === 'topo' ? { gitRemoteIdentity: topoRemote } : {})
  }
}

export type ParityHostAnswer = {
  target: RuntimeClientTarget
  hostId: ExecutionHostId
  /** In the host's own repo.list order. */
  repos: Repo[]
  /** The host's project.list/projectHostSetup.list rows; null for a host that predates them. */
  lists: ProjectHostSetupProjection | null
}

const localRepos = [
  hostRepo('local-stably', '/Users/jinwoo/stably/topo'),
  hostRepo('local-assets', '/Users/jinwoo/design-assets', 'design-assets'),
  hostRepo('local-workspace', '/Users/jinwoo/topo/workspaces/topo/topo')
]
const windowsRepo = hostRepo('win-topo', 'C:/Users/jinwo/topo/topo')

// Several local checkouts plus copies of the same project on two servers.
export const PROJECT_SECTION_PARITY_HOSTS: readonly ParityHostAnswer[] = [
  {
    target: { kind: 'local' },
    hostId: 'local',
    repos: localRepos,
    lists: projectHostSetupProjectionFromRepos(localRepos)
  },
  {
    target: { kind: 'environment', environmentId: 'windows2' },
    hostId: 'runtime:windows2',
    repos: [windowsRepo],
    // A server's own catalog rows: its project name and an imported setup on its local host.
    lists: {
      projects: [
        {
          id: 'github:brandonhsz/Topoductor',
          displayName: 'Topo',
          badgeColor: '#737373',
          providerIdentity: { provider: 'github', owner: 'brandonhsz', repo: 'topo' },
          sourceRepoIds: [windowsRepo.id],
          createdAt: 5,
          updatedAt: 5
        }
      ],
      setups: [
        {
          id: 'win-setup',
          projectId: 'github:brandonhsz/Topoductor',
          hostId: 'local',
          repoId: windowsRepo.id,
          path: windowsRepo.path,
          displayName: 'topo',
          setupState: 'ready',
          setupMethod: 'imported-existing-folder',
          createdAt: 5,
          updatedAt: 5
        }
      ]
    }
  },
  {
    target: { kind: 'environment', environmentId: 'm4air' },
    hostId: 'runtime:m4air',
    repos: [
      hostRepo('m4-topo', '/Users/m4air/topo/topo'),
      hostRepo('m4-topo-two', '/Users/m4air/topo-two/topo')
    ],
    lists: null
  }
]

/** Workspace rows; activity order differs from catalog order, so Recent and Manual disagree. */
export const PROJECT_SECTION_PARITY_ROWS: readonly {
  id: string
  repoId: string
  lastActivityAt: number
}[] = [
  { id: 'wt-m4-two', repoId: 'm4-topo-two', lastActivityAt: 90 },
  { id: 'wt-win', repoId: 'win-topo', lastActivityAt: 70 },
  { id: 'wt-workspace', repoId: 'local-workspace', lastActivityAt: 50 },
  { id: 'wt-stably', repoId: 'local-stably', lastActivityAt: 30 },
  { id: 'wt-m4', repoId: 'm4-topo', lastActivityAt: 10 }
]

// Same-host checkouts still need path prefixes; other machines do not.
const STABLY = {
  key: 'project:github:brandonhsz/Topoductor::setup:local-stably',
  label: 'stably/topo'
}
const WORKSPACE = {
  key: 'project:github:brandonhsz/Topoductor::setup:local-workspace',
  label: 'topo/topo'
}
// Why 'topo', not the server's 'Topo': the later host's derived project name wins the merge.
const WINDOWS = { key: 'project:github:brandonhsz/Topoductor', label: 'topo' }
const M4 = { key: 'project:github:brandonhsz/Topoductor::setup:m4-topo', label: 'topo/topo' }
const M4_TWO = {
  key: 'project:github:brandonhsz/Topoductor::setup:m4-topo-two',
  label: 'topo-two/topo'
}
const ASSETS = { key: 'project:repo:local-assets', label: 'design-assets' }

export const PROJECT_SECTION_PARITY_HEADERS = {
  recent: [M4_TWO, WINDOWS, WORKSPACE, STABLY, M4, ASSETS],
  manual: [STABLY, ASSETS, WORKSPACE, WINDOWS, M4, M4_TWO]
} as const

/** What main serves the phone for these answers (the renderer's published catalog). */
export const PROJECT_SECTION_PARITY_SERVED: MobileProjectSectionCatalog = {
  repos: [
    {
      id: 'local-stably',
      displayName: 'topo',
      path: '/Users/jinwoo/stably/topo',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-assets',
      displayName: 'design-assets',
      path: '/Users/jinwoo/design-assets',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-workspace',
      displayName: 'topo',
      path: '/Users/jinwoo/topo/workspaces/topo/topo',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'win-topo',
      displayName: 'topo',
      path: 'C:/Users/jinwo/topo/topo',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-topo',
      displayName: 'topo',
      path: '/Users/m4air/topo/topo',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-topo-two',
      displayName: 'topo',
      path: '/Users/m4air/topo-two/topo',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    }
  ],
  projects: [
    { id: 'repo:local-assets', displayName: 'design-assets' },
    { id: 'github:brandonhsz/Topoductor', displayName: 'topo' }
  ],
  setups: [
    {
      id: 'local-stably',
      projectId: 'github:brandonhsz/Topoductor',
      hostId: 'local',
      repoId: 'local-stably',
      path: '/Users/jinwoo/stably/topo',
      displayName: 'topo',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-assets',
      projectId: 'repo:local-assets',
      hostId: 'local',
      repoId: 'local-assets',
      path: '/Users/jinwoo/design-assets',
      displayName: 'design-assets',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-workspace',
      projectId: 'github:brandonhsz/Topoductor',
      hostId: 'local',
      repoId: 'local-workspace',
      path: '/Users/jinwoo/topo/workspaces/topo/topo',
      displayName: 'topo',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'win-setup',
      projectId: 'github:brandonhsz/Topoductor',
      hostId: 'runtime:windows2',
      repoId: 'win-topo',
      path: 'C:/Users/jinwo/topo/topo',
      displayName: 'topo',
      setupMethod: 'imported-existing-folder',
      connectionId: null,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-topo',
      projectId: 'github:brandonhsz/Topoductor',
      hostId: 'runtime:m4air',
      repoId: 'm4-topo',
      path: '/Users/m4air/topo/topo',
      displayName: 'topo',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-topo-two',
      projectId: 'github:brandonhsz/Topoductor',
      hostId: 'runtime:m4air',
      repoId: 'm4-topo-two',
      path: '/Users/m4air/topo-two/topo',
      displayName: 'topo',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    }
  ],
  projectOrderBy: 'manual'
}
