import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../../../../shared/update-status-types'
import { createUIStore } from './ui-slice-test-harness'

const VERSION = '1.4.300'

describe('updateInstallOnDownload', () => {
  it('starts without an install intent', () => {
    expect(createUIStore().getState().updateInstallOnDownload).toBe(false)
  })

  it.each<UpdateStatus>([
    { state: 'available', version: VERSION, changelog: null },
    { state: 'error', message: 'download failed', version: VERSION },
    { state: 'idle' },
    { state: 'not-available' },
    { state: 'checking', userInitiated: true }
  ])('clears the install intent on $state', (status) => {
    const store = createUIStore()
    store.getState().setUpdateInstallOnDownload(true)
    store.getState().setUpdateStatus(status)
    expect(store.getState().updateInstallOnDownload).toBe(false)
  })

  it.each<UpdateStatus>([
    { state: 'downloading', version: VERSION, percent: 10 },
    { state: 'downloaded', version: VERSION }
  ])('keeps the install intent through $state', (status) => {
    const store = createUIStore()
    store.getState().setUpdateInstallOnDownload(true)
    store.getState().setUpdateStatus(status)
    expect(store.getState().updateInstallOnDownload).toBe(true)
  })
})
