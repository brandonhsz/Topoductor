import { describe, expect, it, vi } from 'vitest'
import {
  findOrphanedTopoSshForward,
  stopOrphanedTopoSshForward,
  type SshForwardProcessRow
} from './system-ssh-orphaned-forward'

const EXPECTED = [
  '-o',
  'BatchMode=no',
  '-T',
  '-N',
  '-o',
  'ExitOnForwardFailure=no',
  '-L',
  '127.0.0.1:47123:127.0.0.1:6768',
  '--',
  'devbox'
]
// What an earlier version spawned for the same forward: ExitOnForwardFailure=yes.
const TOPO_FORWARD =
  '/usr/bin/ssh -o BatchMode=no -T -N -o ExitOnForwardFailure=yes -L 127.0.0.1:47123:127.0.0.1:6768 -- devbox'

function row(pid: number, ppid: number, command: string, creationTimeMs?: number) {
  return { pid, ppid, command, creationTimeMs } satisfies SshForwardProcessRow
}

describe('findOrphanedTopoSshForward', () => {
  it('finds one reparented to a systemd --user subreaper', () => {
    const rows = [row(50, 1, '/usr/lib/systemd/systemd --user'), row(900, 50, TOPO_FORWARD)]
    expect(findOrphanedTopoSshForward(rows, EXPECTED, 'linux')?.pid).toBe(900)
  })

  it('matches across the LogLevel=INFO this version adds, in either direction', () => {
    const withLogLevel = ['-o', 'BatchMode=no', '-o', 'LogLevel=INFO', ...EXPECTED.slice(2)]
    expect(
      findOrphanedTopoSshForward([row(900, 1, TOPO_FORWARD)], withLogLevel, 'darwin')?.pid
    ).toBe(900)
    const newOrphan = `/usr/bin/ssh ${withLogLevel.join(' ')}`
    expect(findOrphanedTopoSshForward([row(900, 1, newOrphan)], withLogLevel, 'darwin')?.pid).toBe(
      900
    )
    const extraLogLevel = TOPO_FORWARD.replace(' -T ', ' -o LogLevel=INFO -o LogLevel=INFO -T ')
    expect(findOrphanedTopoSshForward([row(900, 1, extraLogLevel)], EXPECTED, 'darwin')).toBeNull()
  })

  it('matches an orphan an earlier version spawned without the unmultiplexing -S none', () => {
    const unmultiplexed = ['-o', 'BatchMode=no', '-T', '-S', 'none', ...EXPECTED.slice(3)]
    expect(
      findOrphanedTopoSshForward([row(900, 1, TOPO_FORWARD)], unmultiplexed, 'darwin')?.pid
    ).toBe(900)
    const otherControlPath = TOPO_FORWARD.replace(' -T ', ' -T -S /tmp/cm ')
    expect(
      findOrphanedTopoSshForward([row(900, 1, otherControlPath)], unmultiplexed, 'darwin')
    ).toBeNull()
  })

  it("never picks a forward whose Topo is still running (another instance's tunnel)", () => {
    const rows = [
      row(400, 1, '/Applications/Topo.app/Contents/MacOS/Topo'),
      row(900, 400, TOPO_FORWARD)
    ]
    expect(findOrphanedTopoSshForward(rows, EXPECTED, 'darwin')).toBeNull()
  })

  it("never picks the user's own ssh on the port, even an orphaned daemon in Topo's flag order", () => {
    const rows = [
      row(900, 1, 'ssh -N -L 127.0.0.1:47123:127.0.0.1:6768 devbox'),
      row(
        901,
        1,
        'ssh -o BatchMode=yes -T -N -o ExitOnForwardFailure=yes -L 127.0.0.1:47123:127.0.0.1:5432 -- production-db'
      ),
      row(902, 1, TOPO_FORWARD.replace('-- devbox', '-- otherbox')),
      row(903, 1, TOPO_FORWARD.replace('/usr/bin/ssh ', '/usr/bin/ssh -f -F /home/u/.ssh/prod '))
    ]
    expect(findOrphanedTopoSshForward(rows, EXPECTED, 'darwin')).toBeNull()
  })

  it('never picks a forward for another port that shares a prefix', () => {
    const command = TOPO_FORWARD.replace('127.0.0.1:47123:', '127.0.0.1:471230:')
    expect(findOrphanedTopoSshForward([row(900, 1, command)], EXPECTED, 'darwin')).toBeNull()
  })

  it('on Windows, treats a missing or younger parent as gone', () => {
    const command = `"C:\\Windows\\System32\\OpenSSH\\ssh.exe" ${TOPO_FORWARD.slice('/usr/bin/ssh '.length)}`
    expect(
      findOrphanedTopoSshForward([row(900, 400, command, 1_000)], EXPECTED, 'win32')?.pid
    ).toBe(900)
    expect(
      findOrphanedTopoSshForward(
        [row(400, 4, 'C:\\Program Files\\Other\\other.exe', 2_000), row(900, 400, command, 1_000)],
        EXPECTED,
        'win32'
      )?.pid
    ).toBe(900)
    expect(
      findOrphanedTopoSshForward(
        [row(400, 4, 'C:\\Topo\\Topo.exe', 500), row(900, 400, command, 1_000)],
        EXPECTED,
        'win32'
      )
    ).toBeNull()
  })

  it('on posix, matches a spaced option value that itself holds a normalized option', () => {
    const proxy = 'ProxyCommand=ssh -o ExitOnForwardFailure=yes -W %h:%p jump'
    const expected = ['-o', proxy, ...EXPECTED]
    const command = `/usr/bin/ssh -o ${proxy} ${EXPECTED.join(' ')}`
    expect(findOrphanedTopoSshForward([row(900, 1, command)], expected, 'linux')?.pid).toBe(900)
  })

  it('on Windows, matches the quoted command line of an argument with spaces', () => {
    const keyPath = 'C:\\Users\\neil\\AppData\\Local\\Temp\\topo-a7c5-win12\\Jane Doe\\id_ed25519'
    const head = ['-o', 'BatchMode=no', '-o', 'LogLevel=INFO', '-T', '-S', 'none', '-p', '22']
    const tail = ['-o', 'IdentitiesOnly=yes', '-N', '-o', 'ExitOnForwardFailure=no']
    const forward = ['-L', '127.0.0.1:47123:127.0.0.1:6768', '--', '10.255.255.1']
    const expected = [...head, '-i', keyPath, ...tail, ...forward]
    // Win32_Process.CommandLine captured on Windows 11 for a Node spawn of `expected`.
    const command = `"C:\\Program Files\\OpenSSH\\ssh.exe" ${head.join(' ')} -i "${keyPath}" ${[...tail, ...forward].join(' ')}`
    expect(findOrphanedTopoSshForward([row(900, 400, command)], expected, 'win32')?.pid).toBe(900)
    const unquoted = command.replace(`"${keyPath}"`, keyPath)
    const otherKey = command.replace('Jane Doe', 'Jane Doe2')
    const extraArg = command.replace(' -i ', ' -v -i ')
    for (const other of [unquoted, otherKey, extraArg]) {
      expect(findOrphanedTopoSshForward([row(900, 400, other)], expected, 'win32')).toBeNull()
    }
  })
})

function esrch(): Error {
  return Object.assign(new Error('gone'), { code: 'ESRCH' })
}

describe('stopOrphanedTopoSshForward', () => {
  it('terminates the orphan and waits until it is gone', async () => {
    let alive = true
    const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0 && !alive) {
        throw esrch()
      }
      if (signal === 'SIGTERM') {
        alive = false
      }
    })
    const stopped = await stopOrphanedTopoSshForward(47123, EXPECTED, {
      listProcesses: async () => [row(900, 1, TOPO_FORWARD)],
      kill,
      readStartTimeMs: async () => 1_000,
      platform: 'darwin'
    })
    expect(stopped).toBe(true)
    expect(kill).toHaveBeenCalledWith(900, 'SIGTERM')
    expect(kill).not.toHaveBeenCalledWith(900, 'SIGKILL')
  })

  it('escalates to SIGKILL only while the same orphan is still there', async () => {
    vi.useFakeTimers()
    try {
      const kill = vi.fn()
      const stopping = stopOrphanedTopoSshForward(47123, EXPECTED, {
        listProcesses: async () => [row(900, 1, TOPO_FORWARD)],
        kill,
        readStartTimeMs: async () => 1_000,
        platform: 'darwin'
      })
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(stopping).resolves.toBe(true)
      expect(kill).toHaveBeenCalledWith(900, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never SIGKILLs a pid that was reused after SIGTERM', async () => {
    vi.useFakeTimers()
    try {
      const kill = vi.fn()
      const listProcesses = vi
        .fn()
        .mockResolvedValueOnce([row(900, 1, TOPO_FORWARD)])
        .mockResolvedValue([row(900, 77, '/usr/bin/vim notes.txt'), row(77, 1, '/bin/zsh')])
      const readStartTimeMs = vi.fn().mockResolvedValueOnce(1_000).mockResolvedValue(90_000)
      const stopping = stopOrphanedTopoSshForward(47123, EXPECTED, {
        listProcesses,
        kill,
        readStartTimeMs,
        platform: 'darwin'
      })
      await vi.advanceTimersByTimeAsync(3_000)
      await stopping
      expect(kill).toHaveBeenCalledWith(900, 'SIGTERM')
      expect(kill).not.toHaveBeenCalledWith(900, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never SIGKILLs when the start time cannot be read, even for the same command', async () => {
    vi.useFakeTimers()
    try {
      const kill = vi.fn()
      const stopping = stopOrphanedTopoSshForward(47123, EXPECTED, {
        listProcesses: async () => [row(900, 1, TOPO_FORWARD)],
        kill,
        readStartTimeMs: async () => null,
        platform: 'darwin'
      })
      await vi.advanceTimersByTimeAsync(3_000)
      await stopping
      expect(kill).not.toHaveBeenCalledWith(900, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
