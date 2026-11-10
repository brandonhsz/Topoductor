import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  findTransport,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { RuntimeClientError } from './types'

export function readMetadata(userDataPath: string): RuntimeMetadata {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
    if (!metadata || !findTransport(metadata, 'unix', 'named-pipe') || !metadata.authToken) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        `Topo runtime metadata is incomplete at ${metadataPath}`
      )
    }
    return metadata
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'runtime_unavailable',
      `Could not read Topo runtime metadata at ${metadataPath}. Start the Topo app first.`
    )
  }
}

export function tryReadMetadata(userDataPath: string): RuntimeMetadata | null {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
  } catch {
    return null
  }
}

export function getDefaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir()
): string {
  if (process.env.TOPO_USER_DATA_PATH) {
    return process.env.TOPO_USER_DATA_PATH
  }
  return getPlatformUserDataPath(platform, homeDir)
}

/** The packaged app's own default profile, ignoring any CLI override. */
export function getPlatformUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir()
): string {
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'topo')
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'APPDATA is not set, so the Topo runtime metadata path cannot be resolved.'
      )
    }
    return join(appData, 'topo')
  }
  // Match Electron’s packaged userData path.
  return join(process.env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'topo')
}
