// Compose the Node-host runtime; paired desktop pages work even without a local browser engine.
import process from 'node:process'
import { getAppEnvironment } from '../../shared/app-environment'
import { resolveUserDataPath } from './topod-app-paths'
import { prepareTopodCliLauncher } from './topod-cli-launcher'
import { installTopodHostAdapters, runTopodQuitHandlers } from './topod-host-adapters'
import { prepareTopodSecretStoreAndMigrate } from './topod-secret-store-startup'
import { describeTopodBindExposure, resolveTopodBindHost } from '../../shared/topod-bind-address'
import {
  flushTopodProfileStoreForShutdown,
  startTopodWithHost,
  stopTopodStructuredAgentSessions
} from './topod-lifecycle'
import { resolveTopodWebClientRoot } from './topod-command-arguments'
import type { TopodRuntimeCleanup } from './topod-runtime-lifetime'
import { bindTopodStopTerminalAdmission } from './topod-stop-terminal-admission'
import type { TopodHandle, TopodOptions } from './topod-start-contract'
import { beginTopodIdleExit } from './topod-managed-idle-exit-host'
import { topodAutomationsKeepHostBusy, startTopodAutomations } from './topod-automations'
import {
  changedAiVaultSearchSettings,
  type AiVaultSearchSettings
} from '../../shared/ai-vault/search/ai-vault-search-settings'
import { stampRuntimeSourceEnv } from '../../shared/runtime-source-env'
import { adoptWslHostLoginEnvironmentLogged } from './topod-wsl-host-login-environment'
import { topodWsPortOptions } from './topod-ws-port-policy'
import { createTopodStartupTiming } from './topod-startup-timing'
import { TOPO_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { restoreTopodTerminalAuthority } from './topod-restored-terminal-authority'
import { installTopodFeatureReadiness } from '../runtime/rpc/topod-feature-readiness'
import { TOPO_SERVE_SUPERVISED_ENV } from '../../shared/serve-supervised-terminal-durability'
import { startTopodEventLoopWatchdog } from './topod-event-loop-watchdog'
import { isAgentStatusHooksEnabled } from '../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'

let closeTopodObservability = (): Promise<void> => Promise.resolve()

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startTopod(options: TopodOptions = {}): Promise<TopodHandle> {
  installTopodHostAdapters()
  // Inherited terminal identity must not fence topod’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.TOPO_USER_DATA_PATH = userDataPath
  const { readiness, instance, stop } = await startTopodWithHost(
    userDataPath,
    (registerCleanup) => startTopodRuntime(options, registerCleanup),
    async () => {
      try {
        runTopodQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        const closing = closeTopodObservability()
        closeTopodObservability = () => Promise.resolve()
        await closing
      }
    }
  )
  const version = getAppEnvironment().getVersion()
  return { readiness, managedStop: { version, runtimeId: readiness.runtimeId, instance }, stop }
}

async function startTopodRuntime(
  options: TopodOptions,
  registerCleanup: (cleanup: TopodRuntimeCleanup) => void
): Promise<Pick<TopodHandle, 'readiness'>> {
  const { time: timed, report: reportStartupTiming } = createTopodStartupTiming()
  // Read before startTopodDaemon consumes the supervised flag; only a supervised server exits on a long stall.
  const eventLoopWatchdog = startTopodEventLoopWatchdog({
    supervised: process.env[TOPO_SERVE_SUPERVISED_ENV] === '1'
  })
  registerCleanup(() => eventLoopWatchdog?.stop())
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironmentLogged()
  const { startTopodDaemon, stopTopodDaemon } = await import('./topod-daemon-supervision')
  // The daemon and its PTYs inherit the adopted login env and nothing later startup writes, so it
  // spawns as soon as that lands, alongside imports, stores and hooks. Rejects only when supervised.
  const daemonStartup = loginEnvironment.then(() => timed('daemon', () => startTopodDaemon()))
  // Observed now: an early abort may never reach the await below.
  void daemonStartup.catch(() => {})
  // Registered first, so it runs last (cleanups run in reverse) and covers an import that throws
  // mid-spawn. It disconnects without killing daemon PTYs that must survive restart, after an
  // in-flight spawn settles; a failed one leaves only the disconnect to do.
  registerCleanup(() => daemonStartup.catch(() => {}).then(() => stopTopodDaemon()))
  const { TopoRuntimeService } = await import('../runtime/topo-runtime')
  const { TopoRuntimeRpcServer } = await import('../runtime/rpc/server/runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installTopodObservability } = await import('./topod-observability')
  closeTopodObservability = installTopodObservability()
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildTopodServeReadiness } = await import('./topod-serve-readiness')
  const { createTopodProfileStateStartup } = await import('./topod-profile-state-startup')
  const { daemonOwnsFreshPersistentPtys } =
    await import('../daemon/providers/lifecycle/daemon-provider-state')
  const { resolveDaemonSessionScrollbackRows } =
    await import('../daemon/sessions/daemon-session-scrollback-window')
  const { collectTopodHealth } = await import('./topod-health')
  const { agentHookServer } = await import('../agent-hooks/server/agent-hook-server')
  await import('../agent-hooks/installation/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/runtime/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/runtime/hook-status-session-tabs-republish')
  const { startTopodAgentHookServer, startTopodManagedAgentHooks } =
    await import('./topod-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/terminal/identity/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let paneGridsForShutdown: { flushPaneGrids(): Promise<void> | null } | null = null
  let profileStoreForShutdown: Parameters<typeof flushTopodProfileStoreForShutdown>[0] | undefined
  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush; the daemon
  // disconnect, registered above, runs last.
  registerCleanup(() => agentHookServer.stop())
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  registerCleanup(async () => {
    // A SQLite-backed topod has no JSON mirror to absorb a debounced write after SIGTERM.
    if (profileStoreForShutdown) {
      await flushTopodProfileStoreForShutdown(profileStoreForShutdown, paneGridsForShutdown)
    }
  })
  registerCleanup(stopTopodStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())
  const { DesktopPushService } = await import('../runtime/push/desktop-push-service')
  const { resolvePushGatewayOrigin } = await import('../runtime/push/push-gateway-origin')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('topod', runtimeUserDataPath)
  await timed('cli-launcher', () => prepareTopodCliLauncher()).catch((error: unknown) => {
    console.warn('[topod] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginTopodIdleExit(runtimeUserDataPath)
  const { applyTopodSessionScannerIdleTimeout } = await import('./topod-session-scanner-idle')
  await applyTopodSessionScannerIdleTimeout()
  // Initialize sealing before Store load unseals protected settings.
  await timed('secret-store', () => prepareTopodSecretStoreAndMigrate(runtimeUserDataPath))
  const { store: profileStore, authority: profileStateAuthority } = await timed('profile', () =>
    createTopodProfileStateStartup(runtimeUserDataPath)
  )
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  profileStoreForShutdown = profileStore
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startTopodStats } = await import('./topod-stats')
  const stats = startTopodStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await startTopodAgentHookServer(agentHookServer, {
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await timed('login-env-wait', () => loginEnvironment)
  const managedAgentHooks = startTopodManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Install the daemon provider before PTY handlers can route their first call.
  await daemonStartup

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { topodCodexAccountHomes } = await import('./topod-codex-account-homes')
  const codexAccountHomes = topodCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  // Gates open where each phase finishes today; RPC starts after all of them (no behavior change).
  const featureReadiness = installTopodFeatureReadiness()
  const { createTopodAccountServices } = await import('./topod-account-services')
  const accountLaunch = createTopodAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const { createTopodPairedEnvironmentOptions } = await import('./topod-paired-environment-options')
  const pairedEnvironments = createTopodPairedEnvironmentOptions()
  const runtime = new TopoRuntimeService(profileStore, stats, {
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    getAdditionalAiVaultCodexHomePaths: () => [
      ...codexAccountHomes.listSessionHomes(),
      ...(accountLaunch?.listCodexSessionHomes() ?? [])
    ],
    // WSL must retain desktop-pushed CODEX_HOME instead of host-selected resolvers.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    ...pairedEnvironments.runtimeOptions,
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // No renderer reveals from this model; it keeps the daemon's live window, which deeper snapshot reads ask first.
    headlessTerminalScrollbackRows: resolveDaemonSessionScrollbackRows(),
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  paneGridsForShutdown = runtime

  accountLaunch?.attachToRuntime(runtime)
  const { installTopodEmulatorBridge } = await import('./topod-emulator-bridge')
  installTopodEmulatorBridge(runtime, registerCleanup)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreTopodHostAccountLaunchEnv } = await import('./topod-host-account-launch-env-store')
  restoreTopodHostAccountLaunchEnv(runtime, runtimeUserDataPath)
  featureReadiness.open('accounts')

  const { installTopodSessionSearchService } = await import('./topod-session-search')
  sessionSearch = await installTopodSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings()
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())
  featureReadiness.open('sessionSearch')

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[topod] agent state rules ${rules.version} (${rules.source})`)
  )
  // Paired phones dictate through this host; keep its model loaded the same way the desktop does.
  const { startSpeechModelWarmup } = await import('../speech/speech-model-warmup')
  startSpeechModelWarmup(profileStore)
  if (TOPO_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } =
      await import('../runtime/terminal/identity/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await restoreTopodTerminalAuthority(runtime, timed, featureReadiness)
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } =
    await import('../runtime/session-graph/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingTopodMigrationShellHistory().catch((error: unknown) => {
    console.error('[topod-migration] installing pending shell history failed:', error)
  })

  const bindHost = resolveTopodBindHost(options.bind)
  bindTopodStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = new TopoRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    serveNetworkSources: {
      allowPublic: options.allowPublic === true,
      refusePublic: options.refusePublic === true,
      pairingAddress: options.pairingAddress ?? null
    },
    webClientRoot: resolveTopodWebClientRoot(options.webClientRoot),
    ...topodWsPortOptions(options.port)
  })
  pairedEnvironments.bindRpc(rpc)
  runtime.setAgentSenderPeerKey(() => rpc.getE2EEPublicKey())
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await timed('rpc', () => rpc.start())
  // The daemon has no window to wait for; its CI-line watches start with the runtime.
  runtime.startPullRequestWatches()
  startTopodAutomations(runtime, profileStore, registerCleanup)
  const pushService = DesktopPushService.create({
    runtime,
    runtimeRpc: rpc,
    gatewayUrl: resolvePushGatewayOrigin(process.env, getAppEnvironment().isPackaged())
  })
  pushService?.start()
  getAppEnvironment().onWillQuit(() => pushService?.stop())
  console.error(`[topod] ${describeTopodBindExposure(bindHost)}`)

  const readiness = await buildTopodServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectTopodHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))
  reportStartupTiming()
  managedAgentHooks.readinessPublished()

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedTopodMigrationCatalog(),
    automationsBusy: () => topodAutomationsKeepHostBusy(profileStore),
    emulatorsBusy: async () =>
      (await runtime.getEmulatorBridge()?.hasLiveManagedSessions()) ?? false,
    registerCleanup
  })
  return { readiness }
}
