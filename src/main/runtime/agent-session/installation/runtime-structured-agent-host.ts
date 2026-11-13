import { ensureStructuredAgentModelCatalogOwner } from '../model-catalog/structured-agent-model-catalog-wiring'
import type { StructuredAgentModelCatalogDeps } from './structured-agent-runtime-registration-types'
import { resolveStructuredCodexAccountKind } from '../environment/structured-agent-account-home'
import { nativeChatShellEnvironmentPolicy } from '../../../../shared/native-chat/native-chat-shell-environment'
import { claudeStructuredAuthPolicyForSettings } from '../../../claude-accounts/claude-structured-auth-policy'
import { resolveStructuredAgentCommand } from '../../../native-chat/structured-agent-command-resolution'
import { structuredAgentConfiguredArgs } from '../../../native-chat/structured-agent-configured-args'
import { getProfileUserDataPath } from '../../../topo-profiles/profile-storage-paths'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import { resolveTuiAgentLaunchEnv } from '../../../../shared/agent-launch/choices/tui-agent-launch-defaults'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { StructuredAgentId } from '../../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { RuntimeWorkspaceCatalog } from '../../workspaces/catalog/workspace-catalog'
import type { TopoRuntimeWithRefreshPtyWorktreeRecordsFromController } from '../../terminal/lifecycle/pty-worktree-refresh'
import type { RuntimeAccountController } from '../environment/runtime-account-controller'
import type { TopoRuntimeWithPruneMobileSessionTabGroupLayout } from '../../session-lifecycle/projection/prune-mobile-session-tab-group-layout'
import type { TopoRuntimeWithGetStructuredAgentSessionCreateSupport } from '../../session-tabs/structured-session-create-support'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentSessionHostDeps } from '../../../native-chat/agent-session-wire/host/structured-agent-session-host-types'
import { TopoRuntimeWithStartTuiIdleVisibleReadProbe } from '../../terminal/wait/terminal-wait-visible-probe'

import { prepareClaudeTopoMcp, prepareCodexTopoMcp } from '../../../mcp/topo-mcp-launch'
import { repoForAgentWorkspace } from '../../../agent-launch/trust/agent-workspace-trust-spawn'
import { getAppEnvironment } from '../../../../shared/app-environment'
export abstract class RuntimeStructuredAgentHost extends TopoRuntimeWithStartTuiIdleVisibleReadProbe {
  /** Apply the host-owning desktop's account overlay to configured agent environment. */
  protected structuredAgentLaunchEnv(
    agent: StructuredAgentId,
    settings: Pick<GlobalSettings, 'agentDefaultEnv'>
  ) {
    return {
      ...resolveTuiAgentLaunchEnv(agent, settings),
      ...this.accounts.hostLaunchEnvFor(agent)
    }
  }

  protected structuredAgentCatalogDependencies(): StructuredAgentModelCatalogDeps {
    return {
      stateDirectory: getProfileUserDataPath(),
      // Resolve plain folder workspaces as well as git worktrees.
      resolveWorkspacePath: async (workspaceId) =>
        (await this.resolveRuntimeFileTarget(`id:${workspaceId}`)).worktree.path,
      resolveClaudeCommand: (options) =>
        resolveStructuredAgentCommand('claude', this.requireStore().getSettings(), options),
      resolveCodexCommand: (options) =>
        resolveStructuredAgentCommand('codex', this.requireStore().getSettings(), options),
      resolveLaunchArgs: (agent) =>
        structuredAgentConfiguredArgs(agent, this.requireStore().getSettings()),
      resolveShellEnvironmentPolicy: () =>
        nativeChatShellEnvironmentPolicy(this.requireStore().getSettings()),
      resolveClaudeAuthPolicy: () =>
        claudeStructuredAuthPolicyForSettings(this.requireStore().getSettings()),
      resolveAgentLaunchEnv: (agent) =>
        isTuiAgent(agent)
          ? this.structuredAgentLaunchEnv(agent, this.requireStore().getSettings())
          : {},
      resolveAgentCommandSettings: () => this.requireStore().getSettings(),
      resolveCodexAccountKind: (home) =>
        resolveStructuredCodexAccountKind(home, this.requireStore().getSettings()),
      resolveAgentAccountHome: (agent) => this.resolveStructuredAgentAccountHome(agent),
      ...(this.prepareCodexCatalogProbeHomeFn
        ? { prepareCodexCatalogProbeHome: this.prepareCodexCatalogProbeHomeFn }
        : {})
    }
  }

  /** Claude chats get the same Topo MCP servers as Claude terminals in that workspace. */
  protected resolveClaudeTopoMcp(workspaceId: string) {
    return prepareClaudeTopoMcp({
      agent: 'claude',
      settings: this.requireStore().getSettings(),
      repo: repoForAgentWorkspace(workspaceId, this.requireStore()),
      userDataPath: getAppEnvironment().getPath('userData')
    })
  }

  protected resolveCodexTopoMcp(workspaceId: string) {
    return prepareCodexTopoMcp({
      settings: this.requireStore().getSettings(),
      repo: repoForAgentWorkspace(workspaceId, this.requireStore())
    })
  }

  async structuredAgentModelCatalog() {
    return (await ensureStructuredAgentModelCatalogOwner(this.structuredAgentCatalogDependencies()))
      .modelCatalog
  }

  /** Read the setting live so turning it off stops every pending automatic continuation. */
  protected usageLimitAutoContinueHostDeps(): StructuredAgentSessionHostDeps['usageLimitAutoContinue'] {
    return {
      isEnabled: () =>
        this.requireStore().getSettings().nativeChatAutoContinueAfterUsageLimit === true,
      subscribe: (changed) => this.requireStore().onSettingsChanged?.(changed) ?? (() => {}),
      isWorkspaceAsleep: (workspaceId) => this.isWorktreeTerminalSleepHeld(workspaceId)
    }
  }

  protected abstract listResolvedWorktreeSnapshot(
    ...args: Parameters<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>
  ): ReturnType<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>

  protected abstract refreshPtyWorktreeRecordsFromController(
    ...args: Parameters<
      TopoRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
    >
  ): ReturnType<
    TopoRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
  >

  protected abstract isWorktreeTerminalSleepHeld(workspaceId: string): boolean

  abstract notifyFolderWorkspaceChanged(): void

  abstract notifyBranchRenamed(repoId: string): void

  abstract notifyWorktreeFolderRenamed(
    repoId: string,
    oldWorktreeId: string,
    newWorktreeId: string
  ): void

  declare getCommitMessageAgentEnvironmentResolvers: RuntimeAccountController['getCommitMessageAgentEnvironment']

  abstract refreshStructuredConversationTabTitle(
    ...args: Parameters<
      TopoRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
    >
  ): ReturnType<
    TopoRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
  >

  abstract resolveStructuredAgentAccountHome(
    ...args: Parameters<
      TopoRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
    >
  ): ReturnType<
    TopoRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
  >

  abstract resolveStructuredAgentLaunchAccountHome(
    ...args: Parameters<
      TopoRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentLaunchAccountHome']
    >
  ): ReturnType<
    TopoRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentLaunchAccountHome']
  >

  abstract prepareStructuredAgentLaunchAccountHome(
    ...args: Parameters<
      TopoRuntimeWithGetStructuredAgentSessionCreateSupport['prepareStructuredAgentLaunchAccountHome']
    >
  ): ReturnType<
    TopoRuntimeWithGetStructuredAgentSessionCreateSupport['prepareStructuredAgentLaunchAccountHome']
  >

  protected abstract assertStructuredChatAcquireAdmissible(
    record: AgentSessionRecord
  ): Promise<void>
}
