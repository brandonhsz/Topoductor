import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { parse } from 'yaml'
import { runProcess } from '@topo/process-host'
import { spawnDetachedWithoutInheritance } from '@topo/process-host/isolated-detached-spawn'
import { getReleaseDownloadUrl } from '../releases/updater-release-readiness'

/**
 * Self-update for macOS builds without a Developer ID signature. Squirrel.Mac rejects an ad-hoc
 * signed update, so these builds download the release zip themselves, verify it against
 * latest-mac.yml, and swap the bundle from a detached script once Topo has quit.
 */

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export type StagedUnsignedMacUpdate = { version: string; appPath: string; workDir: string }

let adHocSigned: boolean | null = null

export function getRunningMacAppBundlePath(): string | null {
  const marker = '.app/Contents/MacOS/'
  const index = process.execPath.indexOf(marker)
  return index === -1 ? null : process.execPath.slice(0, index + '.app'.length)
}

/** Resolve once at updater setup; downloadUpdate reads the cached answer synchronously. */
export async function primeUnsignedMacDetection(): Promise<void> {
  const bundle = getRunningMacAppBundlePath()
  if (process.platform !== 'darwin' || !app.isPackaged || !bundle) {
    adHocSigned = false
    return
  }
  // codesign prints signature details on stderr.
  const result = await runProcess({
    program: '/usr/bin/codesign',
    args: ['-dv', '--verbose=2', bundle],
    timeoutMs: 30_000
  })
  adHocSigned =
    result.code === 0 &&
    (/Signature=adhoc/.test(result.stderr) || !/Authority=/.test(result.stderr))
}

export function isUnsignedMacSelfUpdateEnabled(): boolean {
  return adHocSigned === true
}

type ManifestFile = { url: string; sha512: string; size?: number }

function pickArchiveForArch(files: ManifestFile[], version: string): ManifestFile | null {
  const zips = files.filter((file) => file.url.endsWith('.zip'))
  const arm64 = zips.find((file) => file.url.includes('-arm64-'))
  const x64 =
    zips.find((file) => file.url === `Topo-${version}-mac.zip`) ?? zips.find((f) => f !== arm64)
  return (process.arch === 'arm64' ? arm64 : x64) ?? null
}

async function readManifest(tag: string): Promise<ManifestFile[]> {
  const response = await fetch(`${getReleaseDownloadUrl(tag)}/latest-mac.yml`, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    throw new Error(`Could not read the update manifest (${response.status}).`)
  }
  const manifest: unknown = parse(await response.text())
  const files =
    manifest && typeof manifest === 'object' && 'files' in manifest ? manifest.files : null
  if (!Array.isArray(files)) {
    throw new Error('The update manifest lists no files.')
  }
  return files.flatMap((file: unknown) => {
    if (!file || typeof file !== 'object' || !('url' in file) || !('sha512' in file)) {
      return []
    }
    const { url, sha512 } = file
    return typeof url === 'string' && typeof sha512 === 'string' ? [{ url, sha512 }] : []
  })
}

async function downloadVerified(
  url: string,
  sha512: string,
  destination: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the update (${response.status}).`)
  }
  const total = Number(response.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  const file = createWriteStream(destination)
  let received = 0
  let lastPercent = -1
  try {
    for await (const chunk of response.body) {
      hash.update(chunk)
      received += chunk.byteLength
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) => file.once('drain', () => resolve()))
      }
      const percent = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress(percent)
      }
    }
  } finally {
    await new Promise<void>((resolve) => file.end(() => resolve()))
  }
  if (hash.digest('base64') !== sha512) {
    throw new Error('The downloaded update did not match its checksum.')
  }
}

async function runTool(program: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const result = await runProcess({ program, args, timeoutMs })
  if (result.timedOut || result.code !== 0) {
    throw new Error(`${program} failed: ${result.stderr.trim() || result.code}`)
  }
  return result.stdout
}

async function readBundleValue(appPath: string, key: string): Promise<string> {
  const stdout = await runTool('/usr/bin/plutil', [
    '-extract',
    key,
    'raw',
    join(appPath, 'Contents', 'Info.plist')
  ])
  return stdout.trim()
}

export async function downloadUnsignedMacUpdate(
  version: string,
  onProgress: (percent: number) => void
): Promise<StagedUnsignedMacUpdate> {
  const currentBundle = getRunningMacAppBundlePath()
  if (!currentBundle) {
    throw new Error('Could not locate the running Topo.app.')
  }
  const archive = pickArchiveForArch(await readManifest(`v${version}`), version)
  if (!archive) {
    throw new Error(`The release has no macOS ${process.arch} archive.`)
  }
  const workDir = join(app.getPath('temp'), `topo-update-${version}`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const zipPath = join(workDir, 'update.zip')
  await downloadVerified(
    `${getReleaseDownloadUrl(`v${version}`)}/${encodeURIComponent(archive.url)}`,
    archive.sha512,
    zipPath,
    onProgress
  )
  const extractDir = join(workDir, 'extracted')
  await runTool('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], 10 * 60 * 1000)
  const appPath = join(extractDir, 'Topo.app')
  const [bundleId, currentBundleId, bundleVersion] = await Promise.all([
    readBundleValue(appPath, 'CFBundleIdentifier'),
    readBundleValue(currentBundle, 'CFBundleIdentifier'),
    readBundleValue(appPath, 'CFBundleShortVersionString')
  ])
  if (bundleId !== currentBundleId || bundleVersion !== version) {
    throw new Error('The downloaded update is not the expected Topo build.')
  }
  await rm(zipPath, { force: true })
  return { version, appPath, workDir }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Detached so it outlives this process: waits for Topo to exit, swaps the bundle, then relaunches. */
export async function launchUnsignedMacInstaller(staged: StagedUnsignedMacUpdate): Promise<void> {
  const target = getRunningMacAppBundlePath()
  if (!target) {
    throw new Error('Could not locate the running Topo.app.')
  }
  const script = join(staged.workDir, 'install.sh')
  const backup = `${target}.previous`
  await writeFile(
    script,
    [
      '#!/bin/sh',
      `PID=${process.pid}`,
      `TARGET=${shellQuote(target)}`,
      `BACKUP=${shellQuote(backup)}`,
      `NEW=${shellQuote(staged.appPath)}`,
      `WORK=${shellQuote(staged.workDir)}`,
      'i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done',
      'rm -rf "$BACKUP"',
      'if mv "$TARGET" "$BACKUP" && /usr/bin/ditto "$NEW" "$TARGET"; then',
      '  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null',
      '  rm -rf "$BACKUP"',
      'else',
      '  rm -rf "$TARGET"; mv "$BACKUP" "$TARGET"',
      'fi',
      '/usr/bin/open "$TARGET"',
      'rm -rf "$WORK"',
      ''
    ].join('\n')
  )
  await chmod(script, 0o700)
  spawnDetachedWithoutInheritance({ program: '/bin/sh', args: [script] }).unref()
}
