import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { runProcess } from '@topo/process-host'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  emptyTopodActivationRecord,
  serializeTopodActivationRecord,
  withActivatedVersion
} from '../../managed-server/activation/topod-activation-record'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import type { TopodHostTransport } from '../../managed-server/install/topod-host-transport'
import {
  createWslTopodConnectStateReader,
  parseWslTopodConnectState,
  wslTopodConnectStateHints
} from './wsl-topod-connect-state-snapshot'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('linux-x64')
const ACTIVE = withActivatedVersion(
  emptyTopodActivationRecord(),
  '0.1.0+aa01',
  null,
  new Date('2026-02-02T00:00:00.000Z')
)
let home: string

function target() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand is mocked, so the transport is never used.
  const conn = Object.create(null) as TopodHostTransport
  return { conn, host, remoteHome: home, userDataDir: join(home, '.topo') }
}

function write(relative: string, content: string): void {
  const path = join(home, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'topo-wsl-connect-state-'))
  mockExec.mockReset()
  mockExec.mockImplementation(async (_conn, command) => {
    const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('WSL connect state snapshot fallbacks', () => {
  it('falls back to the plain read when the snapshot command itself fails', async () => {
    write('.topo-remote/topod-active.json', serializeTopodActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(async () => {
      throw new Error('transport closed')
    })
    const reader = createWslTopodConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })

  it('gives no hints when only the fallback read could answer the record', async () => {
    write('.topo-remote/topod-active.json', serializeTopodActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(
      async () =>
        'UNREADABLE\n__TOPO_WSL_CONNECT_STATE_END__\nABSENT\n__TOPO_WSL_CONNECT_STATE_END__\n' +
        'ABSENT\n__TOPO_WSL_CONNECT_STATE_END__\nNONE\n__TOPO_WSL_CONNECT_STATE_END__\nOPEN\n'
    )
    const reader = createWslTopodConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })
})

describe('parseWslTopodConnectState', () => {
  const end = '\n__TOPO_WSL_CONNECT_STATE_END__\n'
  const stat = (pid: number) =>
    `${pid} (node) S ${Array.from({ length: 18 }, () => '0').join(' ')} 77 0`
  const identity = (pid: number) =>
    `PID ${pid}\n0f6e1d2c-3b4a-4958-8776-655443322110\n--topo-identity--\n${stat(1)}\n` +
    `--topo-identity--\n${stat(pid)}\n--topo-identity--\n`
  const answer = (holder: string) =>
    `ABSENT${end}ABSENT${end}PRESENT\n{"pid":9}${end}${holder}${end}OPEN\n`

  it('attaches the holder identity to a present lock, and nothing it cannot parse', () => {
    const lock = parseWslTopodConnectState(answer(identity(9)))?.instanceLock
    expect(lock).toMatchObject({ state: 'present', holder: { pid: 9, guest: { topod: '9:77' } } })
    expect(parseWslTopodConnectState(answer('NONE'))?.instanceLock).toEqual({
      state: 'present',
      raw: '{"pid":9}'
    })
    expect(parseWslTopodConnectState(answer('PID 9\nnoise'))?.instanceLock).not.toHaveProperty(
      'holder'
    )
  })

  it('rejects a truncated answer', () => {
    expect(parseWslTopodConnectState('ABSENT\n__TOPO_WSL_CONNECT_STATE_END__\n')).toBeNull()
  })
})

describe('wslTopodConnectStateHints', () => {
  const snapshot = {
    activation: { state: 'ok' as const, record: ACTIVE },
    transactionAbsent: true,
    instanceLock: { state: 'absent' as const },
    fenceOpen: true
  }

  it('stops hinting once recovery, adoption or admission replaced the record', () => {
    const hints = wslTopodConnectStateHints(snapshot, ACTIVE)
    const replaced = { ...ACTIVE }
    expect(hints.instanceLock(replaced)).toBeUndefined()
    expect(hints.deployPreRead(replaced)).toEqual({})
  })
})
