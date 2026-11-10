import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isNodeRuntimeTarget,
  type NodeRuntimeTarget,
  type ServerTarget
} from '../../../shared/node-runtime-pin'
import { TOPOD_SERVER_TARGET_FILENAME } from '../../../shared/topod-artifacts'
import type { RemoteInstallTransport } from './remote-install-transport'
import { probeLinuxLibc, type GlibcVersion } from '../../node-runtime/linux-libc-probe'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

type TopodDeploymentTargetFacts = {
  target: ServerTarget
  /** The host's glibc, when the libc probe printed one; null on musl and non-Linux hosts. */
  glibc: GlibcVersion | null
}

export async function resolveTopodDeploymentTargetFacts(options: {
  conn: RemoteInstallTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<TopodDeploymentTargetFacts> {
  const { host } = options
  if (host.os !== 'linux') {
    return { target: `${host.os}-${host.arch}`, glibc: null }
  }
  const exec =
    options.exec ??
    ((command: string) => execCommand(options.conn, command, { signal: options.signal }))
  const { libc, glibc } = await probeLinuxLibc(exec)
  return {
    target: `linux-${host.arch}-${libc}`,
    glibc
  }
}

/** Read the assembled bundle's recorded runtime target, including compatibility builds. */
export function readTopodBundleTarget(localTopodDir: string): NodeRuntimeTarget {
  const recorded = readFileSync(join(localTopodDir, TOPOD_SERVER_TARGET_FILENAME), 'utf8').trim()
  if (!isNodeRuntimeTarget(recorded)) {
    throw new Error(`The topod bundle names no known server target: ${recorded}`)
  }
  return recorded
}
