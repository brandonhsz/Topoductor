// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toSshExecutionHostId } from '../../../../../../shared/execution-host'
import type { ProjectHostSetup } from '../../../../../../shared/project-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { useAppStore } from '../../../../store/index'
import { RepositoryHostSetupsSection } from './RepositoryHostSetupsSection'

let container: HTMLDivElement
let root: Root

const projectId = 'github:brandonhsz/Topoductor'

function makeRepo(overrides: Partial<Repo> & Pick<Repo, 'id' | 'displayName' | 'path'>): Repo {
  return { badgeColor: '#737373', addedAt: 100, kind: 'git', ...overrides }
}

function makeSetup(
  overrides: Partial<ProjectHostSetup> & Pick<ProjectHostSetup, 'id' | 'repoId' | 'hostId' | 'path'>
): ProjectHostSetup {
  return {
    projectId,
    displayName: 'Topo',
    kind: 'git',
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label)
  )
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('RepositoryHostSetupsSection settings entry scope', () => {
  it('lists only its own settings entry when same-host clones split the project (#20861)', () => {
    const cloneA = makeRepo({ id: 'clone-a', displayName: 'Topo', path: '/work/topo' })
    const cloneB = makeRepo({ id: 'clone-b', displayName: 'Topo B', path: '/work/topo-b' })
    const remoteRepo = makeRepo({
      id: 'remote-repo',
      displayName: 'Topo',
      path: '/home/alice/topo',
      connectionId: 'openclaw 2'
    })
    useAppStore.setState({
      repos: [cloneA, cloneB, remoteRepo],
      projects: [
        {
          id: projectId,
          displayName: 'Topo',
          badgeColor: '#737373',
          sourceRepoIds: [cloneA.id, cloneB.id, remoteRepo.id],
          createdAt: 100,
          updatedAt: 100
        }
      ],
      projectHostSetups: [
        makeSetup({ id: 'clone-a', repoId: 'clone-a', hostId: 'local', path: '/work/topo' }),
        makeSetup({ id: 'clone-b', repoId: 'clone-b', hostId: 'local', path: '/work/topo-b' }),
        makeSetup({
          id: 'remote-repo',
          repoId: 'remote-repo',
          hostId: toSshExecutionHostId('openclaw 2'),
          path: '/home/alice/topo'
        }),
        makeSetup({
          id: 'gpu-setup',
          repoId: '',
          hostId: 'runtime:gpu',
          path: '',
          setupState: 'not-set-up'
        })
      ],
      sshTargetLabels: new Map([['openclaw 2', 'openclaw 2']])
    })

    act(() => {
      root.render(
        React.createElement(RepositoryHostSetupsSection, {
          repo: cloneA,
          settingsEntryRepoIds: new Set(['clone-a']),
          forceVisible: true,
          searchQuery: '',
          searchEntries: []
        })
      )
    })

    expect(container.textContent).toContain('/work/topo')
    expect(container.textContent).toContain('Path pending')
    expect(container.textContent).not.toContain('/work/topo-b')
    expect(container.textContent).not.toContain('/home/alice/topo')
    expect(findButton('Open')).toBeUndefined()
    expect(findButton('Add to another host')).toBeUndefined()
  })
})
