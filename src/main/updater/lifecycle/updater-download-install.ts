import {
  beginMacUpdateDownload,
  deferMacQuitUntilInstallerReady,
  isMacInstallRequested,
  setMacInstallPreflightInProgress
} from '../mac-install/updater-mac-install'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import { isExternallyManagedLinuxInstall } from '../linux-package/linux-update-package-type'
import { updaterCodedMessage } from '../../../shared/updater-failure-copy'
import { QUIT_AND_INSTALL_DELAY_MS } from './updater-state'
import { UpdaterRemoteStatus } from './updater-remote-status'
import { prepareThisProcessShipItStaging } from '../mac-install/shipit-leftover-recovery'
import { app } from 'electron'
import {
  downloadUnsignedMacUpdate,
  isUnsignedMacSelfUpdateEnabled,
  launchUnsignedMacInstaller,
  type StagedUnsignedMacUpdate
} from '../mac-install/unsigned-mac-self-update'
import { releaseSessionsForInstaller } from './updater-installer-session-release'

export abstract class UpdaterDownloadInstall extends UpdaterRemoteStatus {
  private stagedUnsignedMacUpdate: StagedUnsignedMacUpdate | null = null

  // Squirrel.Mac rejects ad-hoc signed updates, so interactive unsigned builds swap the bundle themselves.
  private usesUnsignedMacSelfUpdate(): boolean {
    return this.updateInstallMode === 'interactive' && isUnsignedMacSelfUpdateEnabled()
  }

  protected quitAndInstall(): void {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested()
    ) {
      return
    }

    if (this.deferHeadlessServeInstall('install', this.getPendingInstallVersion())) {
      return
    }
    const staged = this.stagedUnsignedMacUpdate
    if (staged && staged.version === this.getPendingInstallVersion()) {
      void this.installUnsignedMacUpdate(staged)
      return
    }
    // A queued check must not repoint the feed while native staging or installation is pending.
    this.finishActiveUpdateCheckAttempt()
    this.clearBackgroundCheckLaunchPending()
    if (
      !this.isMacStagingDeferredToInstall() &&
      deferMacQuitUntilInstallerReady(
        this.currentStatus,
        this.hasInstallableDownloadedVersion(),
        () => this.getPendingInstallVersion(),
        (status) => this.sendStatus(status)
      )
    ) {
      return
    }

    if (process.platform === 'darwin') {
      setMacInstallPreflightInProgress(true)
    }
    // Defer quit one tick so the renderer can flush state before windows close.
    this.pendingQuitAndInstallTimer = setTimeout(() => {
      void this.performQuitAndInstall()
    }, QUIT_AND_INSTALL_DELAY_MS)
  }

  protected downloadUpdate(): void {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested() ||
      this.downloadInFlight
    ) {
      return
    }
    // Retain availableVersion after errors so Retry Download still works.
    const canStart =
      this.currentStatus.state === 'available' ||
      (this.currentStatus.state === 'error' && this.hasInstallableDownloadedVersion())
    if (!canStart) {
      return
    }
    const version =
      this.currentStatus.state === 'available' ? this.currentStatus.version : this.availableVersion
    if (!version) {
      return
    }
    // Enforce host installability in main for older renderers and direct IPC callers.
    if (isExternallyManagedLinuxInstall()) {
      recordUpdaterLifecycle('linux_package_externally_managed_download_blocked', {
        version
      })
      // A refused Linux pin still owns the release feed; unwind it or background checks remain disabled.
      this.clearAvailableUpdateContext()
      this.restoreReleaseUpdateSource()
      this.sendStatus({
        state: 'error',
        ...updaterCodedMessage('linuxPackageExternallyManaged'),
        version,
        retryable: false
      })
      return
    }
    if (this.deferHeadlessServeInstall('download', version)) {
      return
    }
    if (this.usesUnsignedMacSelfUpdate()) {
      void this.downloadUnsignedMacUpdate(version)
      return
    }
    this.downloadInFlight = true
    const localBuildDownload = this.activeUpdateSource === 'local'
    beginMacUpdateDownload()
    // Acknowledge acceptance before setup delays progress events so the card responds immediately.
    this.sendStatus({ state: 'downloading', percent: 0, version })
    const startDownload = (): void => {
      this.getAutoUpdater()
        .downloadUpdate()
        .catch((err) => {
          this.downloadInFlight = false
          const message = String(err?.message ?? err)
          if (localBuildDownload) {
            this.sendLocalBuildErrorAndRestore(message)
          } else {
            this.sendErrorStatus(message)
          }
        })
    }
    // Prepare before download because Squirrel stages on completion unless staging is deferred to install.
    const preparingStaging = this.isMacStagingDeferredToInstall()
      ? null
      : prepareThisProcessShipItStaging()
    if (preparingStaging) {
      void preparingStaging.then(startDownload)
    } else {
      startDownload()
    }
  }

  private async downloadUnsignedMacUpdate(version: string): Promise<void> {
    this.downloadInFlight = true
    this.stagedUnsignedMacUpdate = null
    this.sendStatus({ state: 'downloading', percent: 0, version })
    try {
      this.stagedUnsignedMacUpdate = await downloadUnsignedMacUpdate(version, (percent) =>
        this.sendStatus({ state: 'downloading', percent, version })
      )
      recordUpdaterLifecycle('unsigned_mac_update_staged', { version })
      this.sendStatus({ state: 'downloaded', version, releaseUrl: this.getKnownReleaseUrl() })
    } catch (error) {
      this.sendErrorStatus(error instanceof Error ? error.message : String(error))
    } finally {
      this.downloadInFlight = false
    }
  }

  private async installUnsignedMacUpdate(staged: StagedUnsignedMacUpdate): Promise<void> {
    this.finishActiveUpdateCheckAttempt()
    this.clearBackgroundCheckLaunchPending()
    this.quitAndInstallInProgress = true
    this.quittingForUpdate = true
    this.sendStatus(
      { state: 'downloaded', version: staged.version, installing: true },
      { force: true }
    )
    try {
      await this.runBeforeUpdateQuitCleanup()
      await launchUnsignedMacInstaller(staged)
      recordUpdaterLifecycle('unsigned_mac_update_install_launched', { version: staged.version })
      releaseSessionsForInstaller()
      this.updateInstallCommitted = true
      app.quit()
    } catch (error) {
      this.resetQuitForUpdateState()
      this.sendToMainWindow('updater:quitAndInstallAborted')
      this.sendInstallFailureStatus({
        state: 'error',
        message: this.withInstallFailureCause(
          'Could not restart to install the update. Topo remains open.',
          error
        ),
        version: staged.version
      })
    }
  }

  protected isQuittingForUpdate(): boolean {
    return this.quittingForUpdate
  }
}
