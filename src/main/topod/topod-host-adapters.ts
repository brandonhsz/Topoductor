import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { TOPOD_CLI_PACKAGE_FILENAME } from '../../shared/topod-artifacts'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import { resolveTopodInstallRoot, resolveTopodPath } from './topod-app-paths'
import { getTopodCliLauncherPath } from './topod-cli-launcher'
import { createTopodSecretStore, type TopodSecretStore } from './topod-secret-store'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { topodSpeechServiceFactories } from './topod-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runTopodQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // Synchronous quit handlers must not preempt the signal handler’s awaited runtime/browser teardown.
  quitRegisteredHandlers = (): void => {
    const errors: unknown[] = []
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        errors.push(error)
      }
    }
    // Failed handlers may leave writers running and keep the instance lock held.
    if (errors.length > 0) {
      throw new AggregateError(errors, 'topod_quit_handlers_failed')
    }
  }
  return {
    getPath: resolveTopodPath,
    getAppPath: () => resolveTopodInstallRoot(),
    getVersion: () => process.env.TOPO_VERSION ?? '0.0.0-topod',
    // Packaged gates production HTTPS/CLI/PATH policy; layout callers must inspect asar separately.
    isPackaged: () => true,
    getCliLauncherPath: getTopodCliLauncherPath,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    getAppMetrics: () => []
  }
}

let topodSecretStore: TopodSecretStore | null = null

export async function prepareTopodSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!topodSecretStore) {
    throw new Error('topod_secret_store_not_installed — call installTopodHostAdapters() first')
  }
  return topodSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampTopodAppVersion(installRoot: () => string = resolveTopodInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...TOPOD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.TOPO_APP_VERSION = version
  }
}

export function installTopodHostAdapters(): void {
  stampTopodAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  topodSecretStore = createTopodSecretStore()
  setSecretStore(topodSecretStore)
  setSpeechServiceFactories(topodSpeechServiceFactories)
}
