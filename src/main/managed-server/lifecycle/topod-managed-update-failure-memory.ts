// Remember failures only for this session so restarting retries once.
export type TopodUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type TopodUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, TopodUpdateFailure>()

function key(host: TopodUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordTopodUpdateFailedThisLaunch(
  host: TopodUpdateFailureHost,
  failure: TopodUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function topodUpdateFailureThisLaunch(
  host: TopodUpdateFailureHost
): TopodUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function topodUpdateFailedThisLaunch(host: TopodUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearTopodUpdateFailedThisLaunch(host: TopodUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}

export function resetTopodUpdateFailuresForTests(): void {
  failedThisLaunch.clear()
}
