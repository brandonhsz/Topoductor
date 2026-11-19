// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessFlowVersionSummary } from '../../../../shared/harness/harness-flow-version-types'
import { HarnessFlowVersions, type HarnessFlowVersionsProps } from './HarnessFlowVersions'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key) => values?.[key] ?? '')
}))
afterEach(cleanup)

// Newest first, as the version store lists them.
const versions: HarnessFlowVersionSummary[] = [
  {
    id: 'v3',
    flowId: 'flow-1',
    createdAt: Date.UTC(2026, 10, 18, 12, 0),
    author: 'agent',
    summary: 'Added a review node'
  },
  {
    id: 'v2',
    flowId: 'flow-1',
    createdAt: Date.UTC(2026, 10, 17, 9, 30),
    author: 'person',
    summary: 'Renamed the plan step'
  },
  {
    id: 'v1',
    flowId: 'flow-1',
    createdAt: Date.UTC(2026, 10, 16, 8, 15),
    author: 'person',
    summary: 'First draft'
  }
]

function renderVersions(overrides: Partial<HarnessFlowVersionsProps> = {}) {
  const props: HarnessFlowVersionsProps = {
    versions,
    currentVersionId: 'v3',
    previewVersionId: null,
    onPreview: vi.fn(),
    onRestore: vi.fn(),
    onBackToCurrent: vi.fn(),
    onSaveVersion: vi.fn(),
    ...overrides
  }
  render(<HarnessFlowVersions {...props} />)
  return props
}

function versionItem(summary: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Versions' })
  const item = within(list)
    .getAllByRole('listitem')
    .find((candidate) => within(candidate).queryByText(summary) !== null)
  if (!item) {
    throw new Error(`no version item for ${summary}`)
  }
  return item
}

describe('HarnessFlowVersions', () => {
  it('lists each version with its summary, author and date', () => {
    renderVersions()

    const items = within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)

    const agentItem = versionItem('Added a review node')
    expect(within(agentItem).getByText('Agent')).toBeTruthy()
    expect(agentItem.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-11-18T12:00:00.000Z'
    )

    const personItem = versionItem('Renamed the plan step')
    expect(within(personItem).getByText('You')).toBeTruthy()
    expect(personItem.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-11-17T09:30:00.000Z'
    )
  })

  it('marks only the current version', () => {
    renderVersions({ currentVersionId: 'v2' })

    expect(versionItem('Renamed the plan step').getAttribute('aria-current')).toBe('true')
    expect(versionItem('Added a review node').getAttribute('aria-current')).toBeNull()
    expect(versionItem('First draft').getAttribute('aria-current')).toBeNull()
  })

  it('previews a version with one click on it', () => {
    const props = renderVersions()

    fireEvent.click(within(versionItem('First draft')).getByRole('button', { name: /First draft/ }))

    expect(props.onPreview).toHaveBeenCalledWith('v1')
  })

  it('steps to the older and newer neighbours of the previewed version', () => {
    const props = renderVersions({ previewVersionId: 'v2' })

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(props.onPreview).toHaveBeenLastCalledWith('v1')

    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(props.onPreview).toHaveBeenLastCalledWith('v3')
  })

  it('steps from the current version when nothing is previewed', () => {
    const props = renderVersions({ currentVersionId: 'v3', previewVersionId: null })

    expect(
      (screen.getByRole('button', { name: 'Next version' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))

    expect(props.onPreview).toHaveBeenCalledWith('v2')
  })

  it('cannot step past the oldest version', () => {
    renderVersions({ previewVersionId: 'v1' })

    expect(
      (screen.getByRole('button', { name: 'Previous version' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('restores the previewed version and can go back to the current one', () => {
    const props = renderVersions({ previewVersionId: 'v1' })

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(props.onRestore).toHaveBeenCalledWith('v1')

    fireEvent.click(screen.getByRole('button', { name: 'Back to current' }))
    expect(props.onBackToCurrent).toHaveBeenCalledTimes(1)
  })

  it('does not save a version with an empty or blank summary', () => {
    const props = renderVersions()
    const save = screen.getByRole('button', { name: 'Save version' }) as HTMLButtonElement

    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: '   ' }
    })
    expect(save.disabled).toBe(true)
    fireEvent.click(save)

    expect(props.onSaveVersion).not.toHaveBeenCalled()
  })

  it('saves a version with the trimmed summary', () => {
    const props = renderVersions()

    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: '  Tightened the review prompt  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))

    expect(props.onSaveVersion).toHaveBeenCalledWith('Tightened the review prompt')
  })

  it('does not save again while a save is in flight', () => {
    renderVersions({ saving: true })

    fireEvent.change(screen.getByRole('textbox', { name: 'Version summary' }), {
      target: { value: 'Tightened the review prompt' }
    })

    expect(
      (screen.getByRole('button', { name: 'Save version' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
