import { join } from 'node:path'
import { hashTopodLauncher } from '../../../shared/topod-build-identity'
import { TOPOD_LAUNCHER_FILENAME } from '../../../shared/topod-artifacts'

export function computeLocalTopodBuildHash(localTopodDir: string): string {
  return hashTopodLauncher(join(localTopodDir, TOPOD_LAUNCHER_FILENAME))
}
