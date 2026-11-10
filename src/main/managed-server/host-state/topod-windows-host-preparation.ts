// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteTopodNodeRuntime } from '../install/topod-remote-node-runtime'
import {
  installTopodWindowsHostScript,
  topodRemoteBaseDir
} from '../install/topod-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { TopodHostTransport } from '../install/topod-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

export async function prepareWindowsTopodHost(options: {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = topodRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteTopodNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'topod-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'topod-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installTopodWindowsHostScript(options, baseDir)
}
