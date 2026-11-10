import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const EMULATOR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['emulator', 'list'],
    summary: "List the worktree's attached emulator sessions (iOS and Android)",
    usage: 'topo emulator list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['emulator', 'devices'],
    summary: 'List all emulator devices/AVDs across iOS and Android',
    usage: 'topo emulator devices [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['emulator', 'attach'],
    summary: 'Attach/start helper for a device and make it active for the worktree',
    usage: 'topo emulator attach [device] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'focus', 'device'],
    positionalArgs: ['device']
  },
  {
    path: ['emulator', 'tap'],
    summary: 'Tap at normalized 0..1 coords (preferred for single taps)',
    usage: 'topo emulator tap <x> <y> [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'x', 'y'],
    positionalArgs: ['x', 'y']
  },
  {
    path: ['emulator', 'type'],
    summary: 'Type text (US ASCII only)',
    usage: 'topo emulator type <text> [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'device', 'emulator', 'worktree'],
    positionalArgs: ['text']
  },
  {
    path: ['emulator', 'gesture'],
    summary: 'Send a multi-point gesture sequence',
    usage: "topo emulator gesture '<json>' [--device <id>] [--worktree <selector>] [--json]",
    allowedFlags: [...GLOBAL_FLAGS, 'points', 'device', 'emulator', 'worktree'],
    positionalArgs: ['points']
  },
  {
    path: ['emulator', 'button'],
    summary: 'Hardware button (home, side_button, etc.)',
    usage: 'topo emulator button <name> [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'name'],
    positionalArgs: ['name']
  },
  {
    path: ['emulator', 'rotate'],
    summary: 'Rotate device',
    usage: 'topo emulator rotate <orientation> [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'orientation'],
    positionalArgs: ['orientation']
  },
  {
    path: ['emulator', 'exec'],
    summary:
      'Raw passthrough (e.g. topo emulator exec --command "tap 0.5 0.7" or "ca-debug blended on")',
    usage: 'topo emulator exec --command <cmd> [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'command', 'device', 'emulator', 'worktree']
  },
  {
    path: ['emulator', 'kill'],
    destructive: true,
    summary: 'Stop helper for device',
    usage: 'topo emulator kill [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree']
  },
  {
    path: ['emulator', 'shutdown'],
    destructive: true,
    summary: 'Stop helper and shut down the simulator device',
    usage:
      'topo emulator shutdown [--device <id>] [--emulator <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree']
  },
  {
    path: ['emulator', 'install'],
    summary: 'Install an APK onto the target Android device',
    usage: 'topo emulator install <apkPath> [--reinstall] [--device <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'path', 'reinstall'],
    positionalArgs: ['path']
  },
  {
    path: ['emulator', 'launch'],
    summary: 'Launch an Android app by package (and optional activity)',
    usage: 'topo emulator launch <package> [--activity <name>] [--device <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'package', 'activity'],
    positionalArgs: ['package']
  },
  {
    path: ['emulator', 'permissions'],
    summary: 'Grant/revoke an Android runtime permission, or reset all runtime grants',
    usage:
      'topo emulator permissions <grant|revoke> <package> <permission> [--device <id>] [--json]\n       topo emulator permissions reset [--device <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'device',
      'emulator',
      'worktree',
      'op',
      'package',
      'permission'
    ],
    positionalArgs: ['op', 'package', 'permission']
  },
  {
    path: ['emulator', 'ax'],
    summary: 'Dump the accessibility tree (Android uiautomator; iOS serve-sim AX, frames 0..1)',
    usage: 'topo emulator ax [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree']
  },
  {
    path: ['emulator', 'logcat'],
    summary: 'Capture a one-shot logcat dump from the Android device',
    usage: 'topo emulator logcat [--lines <n>] [--device <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'device', 'emulator', 'worktree', 'lines']
  }
]
