import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { TopodManagedPendingMigrationRow } from '../../../../../../shared/topod-managed-runtime'
import {
  getTopodSshDeployment,
  type PublicKnownRuntimeEnvironment
} from '../../../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../../../../shared/ssh-types'
import type { ManagedTopodPreloadApi } from '../../../../../../preload/api/managed-topod-api'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getManagedTopodApi } from '@/runtime/hosts/installation/managed-topod-api-availability'
import { managedServerOutcomeLabel } from './managed-server-copy'

export type ManagedServerCatalog = {
  /** Absent in the web client, which can't reach SSH hosts. */
  api: ManagedTopodPreloadApi | undefined
  targets: SshTarget[]
  /** SSH hosts that don't already run, or move to, a managed server. */
  emptyTargets: SshTarget[]
  pending: TopodManagedPendingMigrationRow[]
  loadFailed: boolean
  resumingId: string | null
  reload: () => Promise<void>
  resume: (row: TopodManagedPendingMigrationRow) => Promise<void>
}

export function useManagedServerCatalog(
  environments: PublicKnownRuntimeEnvironment[],
  onChanged: () => void
): ManagedServerCatalog {
  const api = getManagedTopodApi()
  const mountedRef = useMountedRef()
  const [targets, setTargets] = useState<SshTarget[]>([])
  const [pending, setPending] = useState<TopodManagedPendingMigrationRow[]>([])
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const reload = useCallback(async () => {
    if (!api) {
      return
    }
    const [nextTargets, nextPending] = await Promise.all([
      window.api.ssh.listTargets(),
      api.listPendingMigrations()
    ])
    if (mountedRef.current) {
      setTargets(nextTargets)
      setPending(nextPending)
      setLoadFailed(false)
    }
  }, [api, mountedRef])

  useEffect(() => {
    void reload().catch(() => mountedRef.current && setLoadFailed(true))
  }, [mountedRef, reload])

  // Running or migrating servers already occupy the host.
  const busyTargetIds = new Set([
    ...environments.map((environment) => getTopodSshDeployment(environment)?.sshTargetId),
    ...pending.map((row) => row.sshTargetId)
  ])
  const emptyTargets = targets.filter(
    (target) => !target.topodFence && !busyTargetIds.has(target.id)
  )

  const resume = async (row: TopodManagedPendingMigrationRow): Promise<void> => {
    if (!api || resumingId) {
      return
    }
    setResumingId(row.migrationId)
    try {
      const result = await api.convertSshHost({ sshTargetId: row.sshTargetId, name: row.name })
      if (result.outcome !== 'converted') {
        toast.message(managedServerOutcomeLabel(result))
      }
      onChanged()
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current) {
        setResumingId(null)
      }
    }
  }

  return { api, targets, emptyTargets, pending, loadFailed, resumingId, reload, resume }
}
