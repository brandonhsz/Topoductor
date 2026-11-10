/**
 * WSL reads an active slot's liveness, readiness and pid in one guest command; SSH keeps
 * `probeActiveTopodReadiness`'s separate reads. The answers are judged exactly as those are.
 */
import type { TopodHostTarget } from '../../managed-server/install/topod-host-transport'
import type { TopodRemoteContext } from '../../managed-server/install/topod-remote-context'
import { topodLivenessProbeCommand } from '../../managed-server/install/topod-remote-launch'
import { readTopodReadinessNowCommand } from '../../managed-server/install/topod-remote-readiness-wait'
import { execTopodRemote } from '../../managed-server/install/topod-remote-runtime-control'
import { TOPOD_PID_FILENAME } from '../../managed-server/install/topod-remote-host-support'
import { managedTopodInstallDir } from '../../managed-server/lifecycle/topod-managed-runtime-context'
import {
  activeTopodReadinessFromOutput,
  assertActiveTopodLive,
  TopodActiveReadinessError
} from '../../managed-server/activation/topod-active-readiness'
import { computeLocalTopodBuildHash } from '../../managed-server/install/topod-local-build-hash'
import type { ServeReadiness } from '../../server/serve-readiness'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'

const SECTION_END = '__TOPO_WSL_ACTIVE_PROBE_END__'

type WslContext = TopodRemoteContext<TopodHostTarget>

function pidCommand(context: WslContext, fullVersion: string): string {
  const pidFile = joinRemotePath(
    context.host,
    managedTopodInstallDir(context, fullVersion),
    TOPOD_PID_FILENAME
  )
  return `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`
}

function parsePid(output: string): number | null {
  const pid = Number.parseInt(output, 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

export async function readWslTopodPid(
  context: WslContext,
  fullVersion: string,
  signal?: AbortSignal
): Promise<number | null> {
  return parsePid(
    await execCommand(context.connection, pidCommand(context, fullVersion), { signal })
  )
}

/** Each section ends with a marker on its own line; the newline before it is the probe's own. */
export function wslTopodActiveProbeCommand(context: WslContext, fullVersion: string): string {
  const installDir = managedTopodInstallDir(context, fullVersion)
  const end = `printf '\\n%s\\n' ${SECTION_END}`
  return [
    topodLivenessProbeCommand(context.host, installDir),
    end,
    readTopodReadinessNowCommand(context.host, installDir),
    end,
    pidCommand(context, fullVersion)
  ].join('\n')
}

export async function probeWslActiveTopod(
  context: WslContext,
  localTopodDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<{ readiness: ServeReadiness; pid: number | null }> {
  const output = await execTopodRemote(
    { conn: context.connection, host: context.host, signal },
    wslTopodActiveProbeCommand(context, fullVersion)
  )
  const sections = output.split(`\n${SECTION_END}\n`)
  if (sections.length !== 3) {
    throw new TopodActiveReadinessError(
      'unverifiable',
      `topod ${fullVersion} process state is unverifiable.`
    )
  }
  const [liveness = '', readiness = '', pid = ''] = sections
  const expectation = { buildHash: computeLocalTopodBuildHash(localTopodDir), fullVersion }
  assertActiveTopodLive(liveness, expectation)
  return {
    readiness: activeTopodReadinessFromOutput(context.host, readiness, expectation),
    pid: parsePid(pid)
  }
}
