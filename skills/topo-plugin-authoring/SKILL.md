---
name: topo-plugin-authoring
description: >-
  Build, debug, test, and publish Topo plugins end to end: app, terminal, and icon themes,
  syntaxes, language packs, custom editors, HTML or TSX components sidebar panels, palette
  commands and shortcuts, and Node worker commands that react to workspace and agent events.
  Use when the user asks to make, change, fix, or ship a Topo plugin, to add a panel,
  command, theme, editor, or language to Topo, or works in a folder with an orca-plugin.json.
  Use `topo-cli` only to list, enable, or disable plugins that are already installed.
---

# Topo Plugin Authoring

This discovery stub loads the version-matched guide from the Topo executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `TOPO_CLI_COMMAND` environment variable is set, use its value. Topo exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `TOPO_DEV_REPO_ROOT`, use `topo-dev`.
- Otherwise, on Linux outside a Topo-managed terminal, use `topo-ide`. Never run bare
  `topo` there — outside Topo's terminals is not on `PATH`.
- Otherwise, use `topo`.

Below, `TOPO` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `TOPO` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Topo build.

## Load the version-matched guide before running Topo commands

```text
TOPO skills get topo-plugin-authoring
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Topo is not running, start it with `TOPO open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `TOPO open` or restart Topo. If
`skills get` is unknown, explain that updating Topo restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
