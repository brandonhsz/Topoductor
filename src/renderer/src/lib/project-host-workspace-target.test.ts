import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import { resolveWorkspaceCreationTarget } from './project-host-workspace-target'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 1,
    ...overrides
  }
}

function makeProject(
  id: string,
  sourceRepoIds: string[],
  overrides: Partial<Project> = {}
): Project {
  return {
    id,
    displayName: id,
    badgeColor: '#000000',
    sourceRepoIds,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeSetup(
  id: string,
  projectId: string,
  hostId: ExecutionHostId,
  repoId: string,
  overrides: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id,
    projectId,
    hostId,
    repoId,
    path: `/repos/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('project-host workspace target resolution', () => {
  it('matches duplicate repo ids to the setup execution host', () => {
    const localRepo = makeRepo('topo', { path: '/local/topo' })
    const sshRepo = makeRepo('topo', {
      path: '/remote/topo',
      connectionId: 'builder'
    })
    const projects = [makeProject('github:brandonhsz/Topoductor', ['topo'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:brandonhsz/Topoductor', 'local', 'topo'),
      makeSetup('ssh-setup', 'github:brandonhsz/Topoductor', 'ssh:builder', 'topo')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: [localRepo, sshRepo],
      projects,
      projectHostSetups,
      projectHostSetupId: 'ssh-setup'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        repo: { path: '/remote/topo', connectionId: 'builder' }
      }
    })
  })

  it('keeps an explicit setup for a second checkout of the project on the same host', () => {
    // Two clones of one remote share a project; the picker lists each, so the chosen one must be created in.
    const repos = [makeRepo('topo-main'), makeRepo('topo-review')]
    const projects = [makeProject('github:brandonhsz/Topoductor', ['topo-main', 'topo-review'])]
    const projectHostSetups = [
      makeSetup('topo-main', 'github:brandonhsz/Topoductor', 'local', 'topo-main'),
      makeSetup('topo-review', 'github:brandonhsz/Topoductor', 'local', 'topo-review')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectHostSetupId: 'topo-review'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'topo-review', repoId: 'topo-review', hostId: 'local' }
    })
  })

  it('does not fall back to another host when only a host is selected', () => {
    const localRepo = makeRepo('topo-local')
    const remoteRepo = makeRepo('topo-ssh', { connectionId: 'builder' })
    const projects = [makeProject('github:brandonhsz/Topoductor', ['topo-local', 'topo-ssh'])]
    const projectHostSetups = [
      makeSetup('topo-local', 'github:brandonhsz/Topoductor', 'local', 'topo-local')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'topo-local',
        hostId: 'ssh:builder',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('does not silently switch an explicit setup id to an actionable sibling host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const localRepo = makeRepo('local-repo')
    const projects = [makeProject('repo:topo', ['remote-repo', 'local-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:topo', 'ssh:removed', 'remote-repo'),
      makeSetup('local-setup', 'repo:topo', 'local', 'local-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo, localRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })
})
