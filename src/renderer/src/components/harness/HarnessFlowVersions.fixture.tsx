import { defineFixture } from '../../component-fixtures/component-fixture'
import type { HarnessFlowVersionSummary } from '../../../../shared/harness/harness-flow-version-types'
import { HarnessFlowConflictBanner } from './HarnessFlowConflictBanner'
import { HarnessFlowVersions } from './HarnessFlowVersions'

const versions: HarnessFlowVersionSummary[] = [
  {
    id: 'v4',
    flowId: 'flow-1',
    createdAt: Date.UTC(2026, 10, 18, 12, 0),
    author: 'agent',
    summary: 'Added a review node after the synthesis'
  },
  {
    id: 'v3',
    flowId: 'flow-1',
    createdAt: Date.UTC(2026, 10, 17, 16, 45),
    author: 'person',
    summary: 'Tightened the review prompt'
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
    author: 'agent',
    summary: 'First draft'
  }
]

const noop = (): void => {}

export const panel = defineFixture({
  width: 320,
  render: () => (
    <div className="flex flex-col gap-4 border-l border-border p-4">
      <HarnessFlowConflictBanner
        summary="Added a review node after the synthesis"
        onUseAgent={noop}
        onKeepMine={noop}
      />
      <HarnessFlowVersions
        versions={versions}
        currentVersionId="v4"
        previewVersionId="v2"
        onPreview={noop}
        onRestore={noop}
        onBackToCurrent={noop}
        onSaveVersion={noop}
      />
    </div>
  )
})

export const empty = defineFixture({
  width: 320,
  render: () => (
    <div className="border-l border-border p-4">
      <HarnessFlowVersions
        versions={[]}
        currentVersionId={null}
        previewVersionId={null}
        onPreview={noop}
        onRestore={noop}
        onBackToCurrent={noop}
        onSaveVersion={noop}
      />
    </div>
  )
})

export const conflict = defineFixture({
  width: 720,
  render: () => (
    <HarnessFlowConflictBanner
      summary="Added a review node after the synthesis"
      onUseAgent={noop}
      onKeepMine={noop}
    />
  )
})
