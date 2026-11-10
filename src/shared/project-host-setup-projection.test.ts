import { describe, expect, it } from 'vitest'
import {
  projectHostSetupProjectionFromRepos,
  getProjectHostSetupsForProject
} from './project-host-setup-projection'
import { getProjectHostSetupWorktreeMeta } from './project-host-setup-lookup'
import type { Repo } from './repo-types'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id' | 'path' | 'displayName'>): Repo {
  return {
    badgeColor: '#737373',
    addedAt: 100,
    kind: 'git',
    ...overrides
  }
}

describe('project host setup projection', () => {
  it('keeps timestamps stable when addedAt is 0 across different now values', () => {
    const target = repo({
      id: 'repo-1',
      path: '/Users/alice/topo',
      displayName: 'topo',
      addedAt: 0
    })
    const first = projectHostSetupProjectionFromRepos([target], 1_000)
    const second = projectHostSetupProjectionFromRepos([target], 9_999)

    expect(first.projects[0]?.createdAt).toBe(0)
    expect(first.projects[0]?.updatedAt).toBe(0)
    expect(first.setups[0]?.createdAt).toBe(0)
    expect(second.projects[0]?.createdAt).toBe(first.projects[0]?.createdAt)
    expect(second.projects[0]?.updatedAt).toBe(first.projects[0]?.updatedAt)
    expect(second.setups[0]?.createdAt).toBe(first.setups[0]?.createdAt)
    expect(second.setups[0]?.updatedAt).toBe(first.setups[0]?.updatedAt)
  })

  // Unknown timestamps may occur first in host/disk order; neither order may erase known sibling times.
  const timestampedSibling = repo({
    id: 'local-repo',
    path: '/Users/alice/topo',
    displayName: 'Topo',
    addedAt: 100,
    upstream: { owner: 'Brandonhsz', repo: 'Topo' }
  })
  const unknownSibling = repo({
    id: 'remote-repo',
    path: '/home/alice/topo',
    displayName: 'topo',
    addedAt: 0,
    connectionId: 'gpu-vm',
    upstream: { owner: 'brandonhsz', repo: 'topo' }
  })

  it('does not wipe a persisted createdAt when a sibling repo has addedAt 0', () => {
    const projection = projectHostSetupProjectionFromRepos([timestampedSibling, unknownSibling])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]?.createdAt).toBe(100)
    expect(projection.projects[0]?.updatedAt).toBe(100)
  })

  it('does not wipe a persisted createdAt when the addedAt 0 sibling comes first', () => {
    const projection = projectHostSetupProjectionFromRepos([unknownSibling, timestampedSibling])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]?.createdAt).toBe(100)
    expect(projection.projects[0]?.updatedAt).toBe(100)
  })

  it('keeps per-repo setup timestamps independent of sibling order', () => {
    for (const repos of [
      [timestampedSibling, unknownSibling],
      [unknownSibling, timestampedSibling]
    ]) {
      const { setups } = projectHostSetupProjectionFromRepos(repos)
      const timestamped = setups.find((setup) => setup.repoId === 'local-repo')
      const unknown = setups.find((setup) => setup.repoId === 'remote-repo')
      expect(timestamped?.createdAt).toBe(100)
      expect(timestamped?.updatedAt).toBe(100)
      // Setups are per repo and never merged, so the unknown one keeps its own 0 either way.
      expect(unknown?.createdAt).toBe(0)
      expect(unknown?.updatedAt).toBe(0)
    }
  })

  it('preserves host-local setup fields on SSH repos', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'remote-repo',
        path: '/home/alice/topo',
        displayName: 'topo',
        connectionId: 'openclaw 2',
        worktreeBasePath: '../worktrees',
        gitUsername: 'alice'
      })
    ])

    expect(projection.setups[0]).toMatchObject({
      id: 'remote-repo',
      hostId: 'ssh:openclaw%202',
      connectionId: 'openclaw 2',
      worktreeBasePath: '../worktrees',
      gitUsername: 'alice'
    })
  })

  it('groups repo checkouts with the same provider identity under one project', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'local-repo',
        path: '/Users/alice/topo',
        displayName: 'Topo',
        upstream: { owner: 'Brandonhsz', repo: 'Topo' }
      }),
      repo({
        id: 'remote-repo',
        path: '/home/alice/topo',
        displayName: 'topo',
        connectionId: 'gpu-vm',
        upstream: { owner: 'brandonhsz', repo: 'topo' }
      })
    ])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]).toMatchObject({
      id: 'github:brandonhsz/topo',
      sourceRepoIds: ['local-repo', 'remote-repo'],
      providerIdentity: { provider: 'github', owner: 'Brandonhsz', repo: 'Topo' }
    })
    expect(
      getProjectHostSetupsForProject(projection.setups, 'github:brandonhsz/topo')
    ).toHaveLength(2)
  })

  it('keeps same-named github.com and GHES repositories in separate projects', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'dotcom-repo',
        path: '/work/dotcom',
        displayName: 'widgets',
        upstream: { owner: 'acme', repo: 'widgets', host: 'github.com' }
      }),
      repo({
        id: 'enterprise-repo',
        path: '/work/enterprise',
        displayName: 'widgets',
        upstream: { owner: 'acme', repo: 'widgets', host: 'github.acme.test' }
      })
    ])

    expect(projection.projects).toHaveLength(2)
    expect(projection.projects.map((project) => project.id)).toEqual([
      'github:acme/widgets',
      'github:github.acme.test/acme/widgets'
    ])
    expect(projection.projects[1]?.providerIdentity).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      host: 'github.acme.test'
    })
  })

  it('groups GHES icon identities only when their hosts match', () => {
    const enterpriseIcon = (host: string) => ({
      type: 'image' as const,
      src: `https://${host}/acme.png?size=64`,
      source: 'github' as const,
      label: 'acme/widgets'
    })
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'enterprise-local',
        path: '/work/local',
        displayName: 'widgets',
        repoIcon: enterpriseIcon('github.acme.test')
      }),
      repo({
        id: 'enterprise-ssh',
        path: '/work/ssh',
        displayName: 'widgets',
        connectionId: 'builder',
        repoIcon: enterpriseIcon('github.acme.test')
      }),
      repo({
        id: 'other-enterprise',
        path: '/work/other',
        displayName: 'widgets',
        repoIcon: enterpriseIcon('github.other.test')
      })
    ])

    expect(projection.projects).toHaveLength(2)
    expect(projection.projects[0]).toMatchObject({
      id: 'github:github.acme.test/acme/widgets',
      sourceRepoIds: ['enterprise-local', 'enterprise-ssh']
    })
    expect(projection.projects[1]?.id).toBe('github:github.other.test/acme/widgets')
  })

  it('uses GitHub repo icon metadata as a provider identity fallback', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'local-repo',
        path: '/Users/alice/topo',
        displayName: 'Topo',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/brandonhsz.png?size=64',
          source: 'github',
          label: 'brandonhsz/topo'
        }
      }),
      repo({
        id: 'remote-repo',
        path: '/home/alice/topo',
        displayName: 'topo',
        connectionId: 'gpu-vm',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/brandonhsz.png?size=64',
          source: 'github',
          label: 'Brandonhsz/Topo'
        }
      })
    ])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]).toMatchObject({
      id: 'github:brandonhsz/topo',
      sourceRepoIds: ['local-repo', 'remote-repo'],
      providerIdentity: { provider: 'github', owner: 'brandonhsz', repo: 'topo' }
    })
    expect(
      getProjectHostSetupsForProject(projection.setups, 'github:brandonhsz/topo')
    ).toHaveLength(2)
  })

  it('uses git remote identity as a provider identity fallback', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'canonical-local-repo',
        path: '/Users/alice/stably/topo',
        displayName: 'topo',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/brandonhsz/topo',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:brandonhsz/topo.git'
        }
      }),
      repo({
        id: 'old-branch-checkout',
        path: '/Users/alice/topo/workspaces/topo/re-enable-webgl-for-remote-runtime-terminals',
        displayName: 're-enable-webgl-for-remote-runtime-terminals',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/brandonhsz.png?size=64',
          source: 'github',
          label: 'brandonhsz/topo'
        }
      })
    ])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]).toMatchObject({
      id: 'github:brandonhsz/topo',
      displayName: 'topo',
      sourceRepoIds: ['canonical-local-repo', 'old-branch-checkout'],
      providerIdentity: { provider: 'github', owner: 'brandonhsz', repo: 'topo' }
    })
  })

  it('uses a GHES canonical remote identity when the remote URL is unavailable', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'enterprise-repo',
        path: '/work/widgets',
        displayName: 'widgets',
        gitRemoteIdentity: {
          canonicalKey: 'github.acme.test/acme/widgets',
          remoteName: 'origin',
          remoteUrl: 'not-a-remote'
        }
      })
    ])

    expect(projection.projects[0]).toMatchObject({
      id: 'github:github.acme.test/acme/widgets',
      providerIdentity: {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        host: 'github.acme.test'
      }
    })
  })

  it('preserves GHES HTTP ports but drops SSH transport ports from remote identity', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'https-repo',
        path: '/work/https',
        displayName: 'widgets',
        gitRemoteIdentity: {
          canonicalKey: 'github.acme.test/acme/widgets',
          remoteName: 'origin',
          remoteUrl: 'https://github.acme.test:8443/acme/widgets.git'
        }
      }),
      repo({
        id: 'ssh-repo',
        path: '/work/ssh',
        displayName: 'widgets',
        gitRemoteIdentity: {
          canonicalKey: 'github.acme.test/acme/widgets',
          remoteName: 'origin',
          remoteUrl: 'ssh://git@github.acme.test:2222/acme/widgets.git'
        }
      })
    ])

    expect(projection.projects.map((project) => project.providerIdentity?.host)).toEqual([
      'github.acme.test:8443',
      'github.acme.test'
    ])
  })

  it('does not guess that same-named folders are the same project without identity', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({ id: 'local-repo', path: '/Users/alice/app', displayName: 'app' }),
      repo({
        id: 'remote-repo',
        path: '/srv/app',
        displayName: 'app',
        connectionId: 'work-server'
      })
    ])

    expect(projection.projects.map((project) => project.id)).toEqual([
      'repo:local-repo',
      'repo:remote-repo'
    ])
  })

  it('groups same-project records across local, SSH, and runtime hosts by git remote identity', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'local-sample-app',
        path: '/Users/alice/work/sample-app',
        displayName: 'sample-app',
        gitRemoteIdentity: {
          canonicalKey: 'git.company.test/team/sample-app',
          remoteName: 'origin',
          remoteUrl: 'git@git.company.test:team/sample-app.git'
        }
      }),
      repo({
        id: 'ssh-sample-app',
        path: '/home/alice/src/sample-app',
        displayName: 'sample-app',
        connectionId: 'build server',
        gitRemoteIdentity: {
          canonicalKey: 'git.company.test/team/sample-app',
          remoteName: 'origin',
          remoteUrl: 'https://git.company.test/team/sample-app.git'
        }
      }),
      repo({
        id: 'runtime-sample-app',
        path: '/workspace/sample-app',
        displayName: 'sample-app',
        executionHostId: 'runtime:dev-container',
        gitRemoteIdentity: {
          canonicalKey: 'git.company.test/team/sample-app',
          remoteName: 'origin',
          remoteUrl: 'ssh://git@git.company.test/team/sample-app.git'
        }
      })
    ])

    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]).toMatchObject({
      id: 'git:git.company.test/team/sample-app',
      displayName: 'sample-app',
      sourceRepoIds: ['local-sample-app', 'ssh-sample-app', 'runtime-sample-app'],
      gitRemoteIdentity: {
        canonicalKey: 'git.company.test/team/sample-app',
        remoteName: 'origin'
      }
    })
    expect(projection.setups.map((setup) => setup.hostId)).toEqual([
      'local',
      'ssh:build%20server',
      'runtime:dev-container'
    ])
    expect(
      getProjectHostSetupsForProject(projection.setups, 'git:git.company.test/team/sample-app')
    ).toHaveLength(3)
  })

  it('does not collapse case-distinct remote paths for self-hosted git remotes', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'uppercase-repo',
        path: '/Users/alice/work/sample-app',
        displayName: 'sample-app',
        gitRemoteIdentity: {
          canonicalKey: 'git.company.test/Team/Sample-App',
          remoteName: 'origin',
          remoteUrl: 'git@git.company.test:Team/Sample-App.git'
        }
      }),
      repo({
        id: 'lowercase-repo',
        path: '/home/alice/src/sample-app',
        displayName: 'sample-app',
        connectionId: 'build server',
        gitRemoteIdentity: {
          canonicalKey: 'git.company.test/team/sample-app',
          remoteName: 'origin',
          remoteUrl: 'git@git.company.test:team/sample-app.git'
        }
      })
    ])

    expect(projection.projects.map((project) => project.id)).toEqual([
      'git:git.company.test/Team/Sample-App',
      'git:git.company.test/team/sample-app'
    ])
  })

  it('ignores malformed provider identity values', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        id: 'repo-1',
        path: '/Users/alice/topo',
        displayName: 'topo',
        upstream: { owner: 'brandonhsz', repo: 42 } as never
      })
    ])

    expect(projection.projects[0]?.id).toBe('repo:repo-1')
    expect(projection.projects[0]?.providerIdentity).toBeUndefined()
  })

  it('derives workspace ownership metadata from the repo setup', () => {
    const targetRepo = repo({
      id: 'remote-repo',
      path: '/home/alice/topo',
      displayName: 'topo',
      connectionId: 'openclaw 2',
      upstream: { owner: 'brandonhsz', repo: 'topo' }
    })
    const projection = projectHostSetupProjectionFromRepos([targetRepo])

    expect(getProjectHostSetupWorktreeMeta(projection.setups, targetRepo)).toEqual({
      projectId: 'github:brandonhsz/topo',
      hostId: 'ssh:openclaw%202',
      projectHostSetupId: 'remote-repo'
    })
  })
})

describe('derived project identity stability', () => {
  const base = { id: 'r', path: '/r', displayName: 'r' } as const

  // Persisted Project keys cannot fold host aliases on upgrade without dropping runtime preferences.
  it('keeps a www. remote provider-neutral instead of folding it onto github.com', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        ...base,
        gitRemoteIdentity: {
          canonicalKey: 'www.github.com/acme/app',
          remoteName: 'origin',
          remoteUrl: 'https://www.github.com/acme/app.git'
        }
      })
    ])
    expect(projection.projects.map((project) => project.id)).toEqual([
      'git:www.github.com/acme/app'
    ])
  })

  it('still folds the documented ssh.github.com alias onto github.com', () => {
    const projection = projectHostSetupProjectionFromRepos([
      repo({
        ...base,
        gitRemoteIdentity: {
          canonicalKey: 'ssh.github.com/acme/app',
          remoteName: 'origin',
          remoteUrl: 'ssh://git@ssh.github.com:443/acme/app.git'
        }
      })
    ])
    expect(projection.projects.map((project) => project.id)).toEqual(['github:acme/app'])
  })
})

describe('getProjectHostSetupWorktreeMeta host selection', () => {
  it("picks the setup for the repo's own execution host when a repoId spans two hosts", () => {
    const sshRepo = repo({
      id: 'repo-shared',
      path: '/remote/topo',
      displayName: 'topo',
      connectionId: 'build-box'
    })
    // Local first in the array: a repoId-only match would stamp the wrong host durably.
    const setups = [
      ...projectHostSetupProjectionFromRepos([
        repo({ id: 'repo-shared', path: '/local/topo', displayName: 'topo' })
      ]).setups,
      ...projectHostSetupProjectionFromRepos([sshRepo]).setups
    ]

    expect(getProjectHostSetupWorktreeMeta(setups, sshRepo).hostId).toBe('ssh:build-box')
  })
})
