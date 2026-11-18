import { afterEach, describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { useAppStore } from '../../store'
import {
  getSidebarUpdateButtonModel,
  type SidebarUpdateButtonModel
} from './sidebar-update-button-model'

const VERSION = '1.4.300'

type Row = [string, UpdateStatus, Partial<SidebarUpdateButtonModel>]

const rows: Row[] = [
  ['idle', { state: 'idle' }, { kind: 'idle', badge: false, action: 'check', disabled: false }],
  [
    'not-available',
    { state: 'not-available' },
    { kind: 'idle', badge: false, action: 'check', disabled: false }
  ],
  [
    'not-available with delayed update',
    {
      state: 'not-available',
      userInitiated: true,
      delayedUpdate: {
        version: VERSION,
        releasedAt: '2026-11-10T00:00:00.000Z',
        availableAt: '2026-11-20T00:00:00.000Z',
        delayDays: 10
      }
    },
    { kind: 'idle', badge: false, action: 'check', disabled: false }
  ],
  [
    'checking',
    { state: 'checking', userInitiated: true },
    { kind: 'checking', badge: false, action: 'none', disabled: true }
  ],
  [
    'available',
    { state: 'available', version: VERSION, changelog: null },
    {
      kind: 'available',
      badge: true,
      version: VERSION,
      action: 'download-and-install',
      disabled: false
    }
  ],
  [
    'available externally managed',
    { state: 'available', version: VERSION, changelog: null, externallyManaged: true },
    { kind: 'external', badge: true, version: VERSION, action: 'expand-card', disabled: false }
  ],
  [
    'downloading',
    { state: 'downloading', version: VERSION, percent: 42 },
    {
      kind: 'downloading',
      badge: true,
      version: VERSION,
      percent: 42,
      action: 'expand-card',
      disabled: false
    }
  ],
  [
    'downloaded',
    { state: 'downloaded', version: VERSION },
    { kind: 'ready', badge: true, version: VERSION, action: 'install', disabled: false }
  ],
  [
    'downloaded installing',
    { state: 'downloaded', version: VERSION, installing: true },
    { kind: 'installing', badge: true, version: VERSION, action: 'none', disabled: true }
  ],
  [
    'error with install block',
    {
      state: 'error',
      message: 'waiting',
      version: VERSION,
      installBlock: { reason: 'running-instances', instances: [] }
    },
    { kind: 'waiting', badge: true, action: 'expand-card', disabled: false }
  ],
  [
    'error with linux package recovery',
    {
      state: 'error',
      message: 'manual',
      recovery: {
        kind: 'linux-package-install',
        packageType: 'deb',
        reason: 'manual-install-required',
        version: VERSION
      }
    },
    { kind: 'external', badge: true, action: 'expand-card', disabled: false }
  ],
  [
    'error with install retry',
    { state: 'error', message: 'install failed', version: VERSION, retryAction: 'install' },
    { kind: 'error', badge: true, version: VERSION, action: 'install', disabled: false }
  ],
  [
    'error with version',
    { state: 'error', message: 'download failed', version: VERSION },
    {
      kind: 'error',
      badge: true,
      version: VERSION,
      action: 'download-and-install',
      disabled: false
    }
  ],
  [
    'error without version',
    { state: 'error', message: 'offline' },
    { kind: 'error', badge: false, version: null, action: 'check', disabled: false }
  ]
]

afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('getSidebarUpdateButtonModel', () => {
  it.each(rows)('maps %s', (_label, status, expected) => {
    expect(getSidebarUpdateButtonModel(status)).toMatchObject(expected)
  })

  it('reports no version or percent when the status has none', () => {
    expect(getSidebarUpdateButtonModel({ state: 'idle' })).toMatchObject({
      version: null,
      percent: null
    })
  })

  it.each([
    [42.4, 42],
    [42.6, 43],
    [-5, 0],
    [130, 100]
  ])('rounds and clamps download percent %d to %d', (raw, expected) => {
    const model = getSidebarUpdateButtonModel({
      state: 'downloading',
      version: VERSION,
      percent: raw
    })
    expect(model.percent).toBe(expected)
  })

  it('keeps the badge on for a version the card dismissed', () => {
    const status: UpdateStatus = { state: 'available', version: VERSION, changelog: null }
    const before = getSidebarUpdateButtonModel(status)
    useAppStore.setState({ dismissedUpdateVersion: VERSION })
    const after = getSidebarUpdateButtonModel(status)
    expect(after).toEqual(before)
    expect(after.badge).toBe(true)
  })
})
