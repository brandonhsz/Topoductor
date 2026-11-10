import { describe, expect, it } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../src/shared/execution-host'
import {
  buildNewWorkspaceProjectOptions,
  buildNewWorkspaceRunTargetOptions,
  getNewWorkspaceRunTarget
} from './new-workspace-project-targets'

const LOCAL_HOST_LABEL = getLocalExecutionHostLabel('darwin')

describe('new workspace project targets', () => {
  it('groups local and SSH checkouts of the same project', () => {
    const upstream = { owner: 'brandonhsz', repo: 'topo' }
    const options = buildNewWorkspaceProjectOptions([
      { id: 'local', displayName: 'topo', path: '/src/topo', upstream },
      {
        id: 'ssh',
        displayName: 'topo',
        path: '/home/dev/topo',
        connectionId: 'build-server',
        upstream
      }
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ label: 'topo', detail: 'brandonhsz/Topoductor' })
  })

  it('shows the provider slug recovered from canonical git identity', () => {
    const options = buildNewWorkspaceProjectOptions([
      {
        id: 'local',
        displayName: 'topo',
        path: '/src/topo',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/brandonhsz/Topoductor',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:brandonhsz/Topoductor.git'
        }
      }
    ])

    expect(options[0]).toMatchObject({ label: 'topo', detail: 'brandonhsz/Topoductor' })
  })

  it('labels local, SSH, and paired runtime targets as the host list names them', () => {
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'topo', path: '/src/topo' }, 'darwin')
    ).toEqual({ hostId: 'local', label: LOCAL_HOST_LABEL, detail: '/src/topo' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'topo', path: 'C:\\src\\topo' })
    ).toMatchObject({ label: 'This computer' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'topo', path: 'C:\\src\\topo' }, 'win32')
    ).toMatchObject({ label: 'Local Windows' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'ssh',
        displayName: 'topo',
        path: 'C:\\src\\topo',
        executionHostId: 'ssh:Windows%20VM'
      })
    ).toEqual({ hostId: 'ssh:Windows%20VM', label: 'Windows VM', detail: 'C:\\src\\topo' })
    const server = {
      id: 'runtime',
      displayName: 'topo',
      path: '/src/topo',
      executionHostId: 'runtime:20269ff3-60aa-4e79-a581-513a3f8e394b'
    } as const
    const labels = new Map([[server.executionHostId, 'scratch-server']] as const)
    expect(getNewWorkspaceRunTarget(server, 'darwin', labels)).toEqual({
      hostId: server.executionHostId,
      label: 'scratch-server',
      detail: '/src/topo'
    })
  })

  it('shows one target per host when the project has multiple local worktrees', () => {
    const upstream = { owner: 'brandonhsz', repo: 'topo' }
    const repos = [
      { id: 'local-a', displayName: 'topo-a', path: '/src/topo-a', upstream },
      { id: 'local-b', displayName: 'topo-b', path: '/src/topo-b', upstream },
      {
        id: 'ssh',
        displayName: 'topo',
        path: '/home/dev/topo',
        connectionId: 'build-server',
        upstream
      }
    ]
    const projectId = buildNewWorkspaceProjectOptions(repos)[0]?.id ?? null

    expect(buildNewWorkspaceRunTargetOptions(repos, projectId, 'darwin')).toEqual([
      expect.objectContaining({ id: 'local', label: LOCAL_HOST_LABEL, detail: '/src/topo-a' }),
      expect.objectContaining({
        id: 'ssh:build-server',
        label: 'build-server',
        detail: '/home/dev/topo'
      })
    ])
  })
})
