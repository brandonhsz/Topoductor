# Topo Orchestration

This discovery stub loads the version-matched guide from the Topo executable used for this session.

Never substitute a non-Topo subagent tool when the user asked for Topo orchestration.

<!-- shared: resolver -->

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

<!-- shared-omit: no-guessing -->

Use the selected executable's `--help` for commands or flags the guide does not cover. If a
command reports that Topo is not running, start it with `TOPO open --json` and retry. If it
fails with `runtime_access_denied`, your sandbox blocked the connection: re-run it with
escalated permissions, and do not run `TOPO open` or restart Topo. If `skills get` is unknown,
explain that updating Topo restores the guide; use `--help` for read-only discovery and do not
guess unsupported commands.
