import { describe, expect, it } from 'vitest'
import { sshExecutionHostStorageIdentity } from '../identity/browser-execution-host-storage-identity'
import {
  deriveBrowserRoutePartition,
  deriveBrowserRoutePartitionStorageScope,
  deriveLocalSshBrowserRoutePartitionStorageScope
} from '../partitions/browser-route-identity'
import { localSshBrowserAuthorityConnectionIdentity } from './local-ssh-browser-partitions'

function derive(topoProfileId: string, browserProfileId: string, targetId: string) {
  return deriveBrowserRoutePartition({
    topoProfileId,
    browserProfileId,
    authorityConnectionIdentity: localSshBrowserAuthorityConnectionIdentity(topoProfileId),
    executionHostIdentity: sshExecutionHostStorageIdentity(targetId)
  })
}

describe('local ssh browser partition identity', () => {
  it('pins the golden partition so no per-boot value can sneak into the name', () => {
    // Changing this cookie-storage identity requires a migration.
    expect(derive('local-default', 'default', 'ssh-target-1').partition).toBe(
      'persist:topo-browser-v1-7462c1b6e5de4158f801f337af48a807e142599db57cd8ad8fe4f00babc2fae1'
    )
  })

  it('derives one stable partition per (profile, target) and separates each axis', () => {
    const base = derive('local-default', 'default', 'ssh-target-1')
    expect(derive('local-default', 'default', 'ssh-target-1')).toEqual(base)
    expect(derive('local-default', 'default', 'ssh-target-2').partition).not.toBe(base.partition)
    expect(derive('local-default', 'session-a', 'ssh-target-1').partition).not.toBe(base.partition)
    expect(derive('profile-b', 'default', 'ssh-target-1').partition).not.toBe(base.partition)
  })

  it('separates the local-ssh storage scope domain from environment scopes', () => {
    expect(
      deriveLocalSshBrowserRoutePartitionStorageScope({
        topoProfileId: 'local-default',
        targetId: 'same-id'
      })
    ).not.toBe(
      deriveBrowserRoutePartitionStorageScope({
        topoProfileId: 'local-default',
        environmentId: 'same-id'
      })
    )
  })
})
