# Low-level topology

```text
TOPO terminal create --worktree active --title <task_name> --command "<agent_command>" --json
TOPO terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
TOPO orchestration dispatch --task <task_id> --to <handle> --inject
```

To give a Task to a terminal or chat Topo did not start:

```text
TOPO orchestration worker-start --task <task_id> --terminal <handle> --worktree <its_workspace> --json
```
