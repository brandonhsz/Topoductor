// Clear the launching terminal’s inherited Topo identity so test branches depend on fixture env, not which agent launched runner.
for (const name of [
  'TOPO_AGENT_SESSION_ID',
  'TOPO_STRUCTURED_SESSION',
  'TOPO_WORKTREE_ID',
  'TOPO_WORKSPACE_ID',
  'TOPO_RUNTIME_SOURCE_ID',
  'TOPO_RUNTIME_SOURCE_INCARNATION',
  'TOPO_RUNTIME_SOURCE_PROFILE_PATH'
]) {
  delete process.env[name]
}
