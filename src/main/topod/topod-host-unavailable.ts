// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class TopodHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopodHostUnsupportedError'
  }
}

export class TopodArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopodArtifactsUnavailableError'
  }
}

export class TopodStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopodStdioBridgeUnavailableError'
  }
}

export const TOPOD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const TOPOD_WINDOWS_LAUNCH_REFUSED_CODE = 'topod_windows_launch_refused'
export const TOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'topod_windows_command_line_unsafe'

export type TopodHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof TOPOD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, TopodHostUnavailableReason> = {
  TopodHostUnsupportedError: 'unsupported_host',
  TopodArtifactsUnavailableError: 'artifacts_unavailable',
  TopodRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  TopodStdioBridgeUnavailableError: TOPOD_TUNNEL_UNAVAILABLE_REASON,
  TopodWindowsLaunchRefusedError: 'unsupported_host',
  TopodWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, TopodHostUnavailableReason> = {
  topod_candidate_preflight_failed: 'native_preflight',
  topod_activation_pty_self_test_failed: 'native_preflight',
  [TOPOD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [TOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new Topo version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<TopodHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isTopodHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function topodCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === TOPOD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === TOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'topod_candidate_launch_failed'
}

export function classifyTopodHostUnavailable(failure: unknown): TopodHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
