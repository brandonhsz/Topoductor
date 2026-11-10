import { TOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/topod-managed-launch-env'

type TopodWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function topodWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): TopodWsPortOptions {
  if (port === undefined) {
    return {}
  }
  const managed = Boolean(env[TOPOD_MANAGED_ACTIVATION_ROOT_ENV])
  return {
    wsPort: port,
    preferPinnedWsPort: true,
    ...(managed ? {} : { requirePinnedWsPort: true })
  }
}
