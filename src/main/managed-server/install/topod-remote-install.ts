import { randomUUID } from 'node:crypto'
import { topodNodePtyNativeArtifacts, topodRipgrepArtifact } from '../../../shared/topod-artifacts'
import { topodAgentBrowserNativeName } from '../../../shared/topod-agent-browser-name'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteTopodNodeRuntime } from './topod-remote-node-runtime'
import { recordedRemoteNodeRuntimeProbeCommand } from './topod-remote-node-runtime-recorded-probe'
import { cachedTopodSlotInstalled } from './topod-remote-install-cached-probe'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { TopodHostTransport } from './topod-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { TOPOD_INSTALL_MODEL } from './remote-install-model'
import { acquireInstallLock } from './remote-install-lock'
import { TOPOD_FENCE_OWNER_FILENAME } from '../activation/topod-activation-fence-scope'
import { forgetHeldTopodFence, rememberHeldTopodFence } from '../activation/topod-held-fence-tokens'
import { exitedOwnLockProof } from '../activation/topod-exited-own-lock'
import { topodWindowsBaseDir } from './topod-remote-windows-node'
import { uploadRemoteInstallDirectory, writeRemoteInstallFile } from './remote-install-transfers'
import {
  abandonInstall,
  finalizeInstall,
  isRemoteInstallComplete
} from './remote-versioned-install'

export async function installTopodBundle(
  options: {
    conn: TopodHostTransport
    host: RemoteHostPlatform
    localTopodDir: string
    target: NodeRuntimeTarget
    /** Lazily acquire verified runtime bytes only if the host needs them. */
    nodeRuntimeArchive: () => Promise<string>
    /** Offline archive location named when downloads fail. */
    nodeRuntimeOfflineArchivePath?: string
    /** Per-source connect budget for the host's own download fallback. */
    nodeRuntimeHostConnectTimeoutSeconds?: number
    /** WSL opt-in: reuse a matching stat signature previously hashed to this pin. */
    recordedNodeRuntimeProbe?: boolean
    signal?: AbortSignal
  },
  fullVersion: string,
  remoteDir: string
): Promise<'uploaded' | 'reused'> {
  if (options.recordedNodeRuntimeProbe && (await cachedTopodSlotInstalled(options, remoteDir))) {
    return 'reused'
  }
  // Existing slot bytes are unusable without their referenced runtime.
  await ensureRemoteTopodNodeRuntime({
    conn: options.conn,
    host: options.host,
    slotDir: remoteDir,
    target: options.target,
    archivePath: options.nodeRuntimeArchive,
    offlineArchivePath: options.nodeRuntimeOfflineArchivePath,
    hostConnectTimeoutSeconds: options.nodeRuntimeHostConnectTimeoutSeconds,
    signal: options.signal,
    ...(options.recordedNodeRuntimeProbe
      ? { posixProbeCommand: recordedRemoteNodeRuntimeProbeCommand }
      : {})
  })
  if (
    await isRemoteInstallComplete(options.conn, TOPOD_INSTALL_MODEL, remoteDir, options.host, {
      signal: options.signal
    })
  ) {
    return 'reused'
  }
  // Persist the token so a relaunch can prove ownership of an interrupted upload lock.
  const token = randomUUID()
  rememberHeldTopodFence(token)
  try {
    await acquireInstallLock(options.conn, remoteDir, options.host, {
      signal: options.signal,
      owner: { fileName: TOPOD_FENCE_OWNER_FILENAME, token },
      // SFTP uploads and chmod leave no host workload after this client exits.
      exitedOwner: exitedOwnLockProof(options, {
        baseDir: topodWindowsBaseDir(options.host, remoteDir),
        guardsStateMutation: false
      })
    })
  } catch (error) {
    if (!isUnconfirmedSshCommandTermination(error)) {
      forgetHeldTopodFence(token)
    }
    throw error
  }
  let preserveInstallLock = false
  try {
    // A sibling may have completed deployment while this client waited for the lock.
    if (
      await isRemoteInstallComplete(options.conn, TOPOD_INSTALL_MODEL, remoteDir, options.host, {
        signal: options.signal
      })
    ) {
      return 'reused'
    }
    await uploadRemoteInstallDirectory(
      options.conn,
      options.localTopodDir,
      remoteDir,
      options.host,
      {
        signal: options.signal
      }
    )
    if (options.host.os !== 'win32') {
      await execCommand(
        options.conn,
        executablePermissionsCommand(options.host, remoteDir, options.target),
        {
          wrapCommand: options.host.commandDialect !== 'powershell',
          signal: options.signal
        }
      )
    }
    await writeRemoteInstallFile(
      options.conn,
      options.host,
      joinRemotePath(options.host, remoteDir, TOPOD_INSTALL_MODEL.versionFilename),
      fullVersion,
      { signal: options.signal }
    )
    await finalizeInstall(options.conn, remoteDir, options.host, {
      signal: options.signal,
      releaseLock: false
    })
    return 'uploaded'
  } catch (error) {
    preserveInstallLock = isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (!preserveInstallLock) {
      // Retain ownership proof if interrupted cleanup cannot confirm lock removal.
      if (await abandonInstall(options.conn, remoteDir, options.host)) {
        forgetHeldTopodFence(token)
      }
    }
  }
}

export function executablePermissionsCommand(
  host: RemoteHostPlatform,
  directory: string,
  target: NodeRuntimeTarget
): string {
  const required = [topodRipgrepArtifact(target), ...topodNodePtyNativeArtifacts(target)]
    .filter((artifact) => /\/(?:rg|spawn-helper)$/.test(artifact))
    .map((artifact) => joinRemotePath(host, directory, ...artifact.split('/')))
  const browsers = new Set(
    (['glibc', 'musl'] as const).map((libc) =>
      quotePosixShell(
        joinRemotePath(host, directory, topodAgentBrowserNativeName(host.os, host.arch, libc))
      )
    )
  )
  // Restore executable modes lost by SFTP; absent optional browser binaries remain supported.
  return (
    `chmod 755 ${required.map(quotePosixShell).join(' ')} && ` +
    `for executable in ${[...browsers].join(' ')}; do ` +
    'if [ -f "$executable" ]; then chmod 755 "$executable" || exit $?; fi; done'
  )
}
