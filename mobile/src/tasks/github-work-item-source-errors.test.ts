import { describe, expect, it } from 'vitest'
import {
  extractGitHubIssueSourceError,
  extractGitHubIssueSourceFallback
} from './github-work-item-source-errors'

describe('extractGitHubIssueSourceError', () => {
  it('keeps the failing issue source slug with the repo that produced it', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/topo' },
        {
          sources: { issues: { owner: 'upstream', repo: 'topo' } },
          errors: { issues: { message: 'HTTP 403: resource not accessible' } }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/topo',
      source: { owner: 'upstream', repo: 'topo' },
      message: 'HTTP 403: resource not accessible'
    })
  })

  it('drops issue errors when the source slug is unavailable', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/topo' },
        {
          sources: { issues: null },
          errors: { issues: { message: 'failed' } }
        }
      )
    ).toBeNull()
  })

  it('returns null when the envelope has no issue-side error', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/topo' },
        {
          sources: { issues: { owner: 'brandonhsz', repo: 'topo' } }
        }
      )
    ).toBeNull()
  })
})

describe('extractGitHubIssueSourceFallback', () => {
  it('reports the repo whose upstream issue source fell back to origin', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/topo', displayName: 'topo' },
        {
          issueSourceFellBack: true,
          sources: {
            issues: { owner: 'brandonhsz', repo: 'topo-fork' },
            prs: { owner: 'brandonhsz', repo: 'topo' }
          }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/topo',
      repoLabel: 'brandonhsz/Topoductor'
    })
  })

  it('uses the Topo repo display name when the PR source is unavailable', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/topo', displayName: 'topo' },
        {
          issueSourceFellBack: true,
          sources: { issues: null, prs: null }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/topo',
      repoLabel: 'topo'
    })
  })

  it('returns null when the source resolver did not fall back', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/topo', displayName: 'topo' },
        {
          sources: { issues: { owner: 'brandonhsz', repo: 'topo' } }
        }
      )
    ).toBeNull()
  })
})
