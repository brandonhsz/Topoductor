// Split suites rewrite platform and agent-home environment; capture and restore the host values.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedTopoOpenCodeConfigDir = process.env.TOPO_OPENCODE_CONFIG_DIR
  const savedTopoOpenCodeSourceConfigDir = process.env.TOPO_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedTopoPiAgentDir = process.env.TOPO_PI_CODING_AGENT_DIR
  const savedTopoPiSourceAgentDir = process.env.TOPO_PI_SOURCE_AGENT_DIR
  const savedTopoCodexHome = process.env.TOPO_CODEX_HOME
  const savedTopoOmpAgentDir = process.env.TOPO_OMP_CODING_AGENT_DIR
  const savedTopoOmpSourceAgentDir = process.env.TOPO_OMP_SOURCE_AGENT_DIR
  const savedTopoOmpStatusExtension = process.env.TOPO_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedTopoPrimeAgentSourceDir = process.env.TOPO_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedTopoPrimeAgentStatusExtension = process.env.TOPO_PRIME_AGENT_STATUS_EXTENSION
  const savedTopoClaudeAgentStatusSettings = process.env.TOPO_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.TOPO_DISABLE_MACOS_LOGIN_SHELL
  const savedTopoUserDataPath = process.env.TOPO_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // POSIX is the default fixture; Windows cases explicitly opt in.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Disable the TCC argv wrapper except in its dedicated tests.
    process.env.TOPO_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.TOPO_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.TOPO_OPENCODE_CONFIG_DIR
    delete process.env.TOPO_AGENT_HOOK_ENDPOINT
    delete process.env.TOPO_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.TOPO_PI_SOURCE_AGENT_DIR
    delete process.env.TOPO_PI_CODING_AGENT_DIR
    delete process.env.TOPO_CODEX_HOME
    delete process.env.TOPO_OMP_SOURCE_AGENT_DIR
    delete process.env.TOPO_OMP_CODING_AGENT_DIR
    delete process.env.TOPO_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.TOPO_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.TOPO_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.TOPO_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.TOPO_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedTopoUserDataPath !== undefined) {
      process.env.TOPO_USER_DATA_PATH = savedTopoUserDataPath
    } else {
      delete process.env.TOPO_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedTopoOpenCodeConfigDir !== undefined) {
      process.env.TOPO_OPENCODE_CONFIG_DIR = savedTopoOpenCodeConfigDir
    } else {
      delete process.env.TOPO_OPENCODE_CONFIG_DIR
    }
    if (savedTopoOpenCodeSourceConfigDir !== undefined) {
      process.env.TOPO_OPENCODE_SOURCE_CONFIG_DIR = savedTopoOpenCodeSourceConfigDir
    } else {
      delete process.env.TOPO_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedTopoPiAgentDir !== undefined) {
      process.env.TOPO_PI_CODING_AGENT_DIR = savedTopoPiAgentDir
    } else {
      delete process.env.TOPO_PI_CODING_AGENT_DIR
    }
    if (savedTopoPiSourceAgentDir === undefined) {
      delete process.env.TOPO_PI_SOURCE_AGENT_DIR
    } else {
      process.env.TOPO_PI_SOURCE_AGENT_DIR = savedTopoPiSourceAgentDir
    }
    if (savedTopoCodexHome === undefined) {
      delete process.env.TOPO_CODEX_HOME
    } else {
      process.env.TOPO_CODEX_HOME = savedTopoCodexHome
    }
    if (savedTopoOmpAgentDir !== undefined) {
      process.env.TOPO_OMP_CODING_AGENT_DIR = savedTopoOmpAgentDir
    } else {
      delete process.env.TOPO_OMP_CODING_AGENT_DIR
    }
    if (savedTopoOmpSourceAgentDir !== undefined) {
      process.env.TOPO_OMP_SOURCE_AGENT_DIR = savedTopoOmpSourceAgentDir
    } else {
      delete process.env.TOPO_OMP_SOURCE_AGENT_DIR
    }
    if (savedTopoOmpStatusExtension !== undefined) {
      process.env.TOPO_OMP_STATUS_EXTENSION = savedTopoOmpStatusExtension
    } else {
      delete process.env.TOPO_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedTopoPrimeAgentSourceDir !== undefined) {
      process.env.TOPO_PRIME_AGENT_SOURCE_AGENT_DIR = savedTopoPrimeAgentSourceDir
    } else {
      delete process.env.TOPO_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedTopoPrimeAgentStatusExtension !== undefined) {
      process.env.TOPO_PRIME_AGENT_STATUS_EXTENSION = savedTopoPrimeAgentStatusExtension
    } else {
      delete process.env.TOPO_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedTopoClaudeAgentStatusSettings === undefined) {
      delete process.env.TOPO_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.TOPO_CLAUDE_AGENT_STATUS_SETTINGS = savedTopoClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
