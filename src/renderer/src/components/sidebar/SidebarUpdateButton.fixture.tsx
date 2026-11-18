import { CircleHelp, Settings } from 'lucide-react'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { Button } from '@/components/ui/button'
import { SidebarUpdateButton } from './SidebarUpdateButton'

const VERSION = '1.4.300'

function footerFixture(updateStatus: UpdateStatus): ReturnType<typeof defineFixture> {
  return defineFixture({
    width: 240,
    store: { updateStatus },
    render: () => (
      <div className="bg-worktree-sidebar text-worktree-sidebar-foreground">
        <div className="flex items-center gap-1 border-t border-worktree-sidebar-border px-2 py-1.5">
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
            <Settings className="size-3.5" />
          </Button>
          <SidebarUpdateButton />
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
            <CircleHelp className="size-3.5" />
          </Button>
        </div>
      </div>
    )
  })
}

export const idle = footerFixture({ state: 'idle' })
export const checking = footerFixture({ state: 'checking', userInitiated: true })
export const available = footerFixture({ state: 'available', version: VERSION, changelog: null })
export const downloading = footerFixture({ state: 'downloading', version: VERSION, percent: 42 })
export const ready = footerFixture({ state: 'downloaded', version: VERSION })
export const error = footerFixture({ state: 'error', message: 'download failed', version: VERSION })
