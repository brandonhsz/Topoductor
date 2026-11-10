---
name: orchestration
description: >-
  Run work in separate Topo worker agents and get their results back. Use when
  the user asks for Topo workers or supervision (monitor, task DAGs, ask/reply,
  decision gates), or when the work needs something your own subagents cannot
  give: a different agent (such as Codex from Claude) or its own Topo workspace.
  "Have Codex (or Claude) review this and report back" means a Topo worker of
  that agent, even when you have your own model subagents.
  Also use when you are a dispatched worker (a prompt with Task and Dispatch
  IDs: ask, worker_done). Otherwise prefer your own subagents,
  including for long or parallel work. Use `topo-cli` to hand work off with
  nothing expected back ("hand off", "handover", "give this to another agent",
  "another worktree"), and for terminal control, shell commands, worktree
  management, and reading or waiting on terminals.
---

# Topo Orchestration

This discovery stub loads the version-matched guide from the Topo executable used for this session.

Never substitute a non-Topo subagent tool when the user asked for Topo orchestration.

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
TOPO skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop and dispatched-worker
obligations. For a conditional action gate such as remote placement, uncertain release
recovery, or expanded DAG work, load only the reference that gate names with
`TOPO skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`TOPO skills get orchestration --full` and read the named bundled reference before acting.

Use the selected executable's `--help` for commands or flags the guide does not cover. If a
command reports that Topo is not running, start it with `TOPO open --json` and retry. If it
fails with `runtime_access_denied`, your sandbox blocked the connection: re-run it with
escalated permissions, and do not run `TOPO open` or restart Topo. If `skills get` is unknown,
explain that updating Topo restores the guide; use `--help` for read-only discovery and do not
guess unsupported commands.
