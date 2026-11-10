import {
  TOPOD_BUILD_TARGET_FILENAME,
  TOPOD_LAUNCHER_FILENAME,
  TOPOD_SERVER_ENTRY_FILENAME,
  TOPOD_NODE_RUNTIME_DIR_PREFIX,
  TOPOD_NODE_RUNTIME_MARKER_FILENAME,
  TOPOD_NODE_RUNTIME_POSIX_EXECUTABLE,
  TOPOD_RUNTIMES_DIRNAME,
  topodBunRuntimeFilename
} from '../../../shared/topod-artifacts'
import { assertPosixTopodHost } from './topod-remote-host-support'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignTopodSlot(directory: string): string {
  return `topod_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectTopodSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixTopodHost(host)
  const server = `"$topod_slot"/${quotePosixShell(TOPOD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$topod_slot"/${quotePosixShell(TOPOD_LAUNCHER_FILENAME)}`
  return `${assignTopodSlot(directory)}if [ -f ${server} ]; then topod_entry=${server}; else topod_entry=${launcher}; fi`
}

/** Set $topod_runtime or exit 78; callers decide what an absent marker means. */
export function topodNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixTopodHost(host)
  const nodeMarker = `"$topod_slot"/${quotePosixShell(TOPOD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${topod_slot%/*}"/${quotePosixShell(
    `${TOPOD_RUNTIMES_DIRNAME}/${TOPOD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${TOPOD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignTopodSlot(directory)}topod_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$topod_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#topod_node_sha}" -eq 64 ] || exit 78; ' +
    `topod_runtime=${nodeRuntimePrefix}"$topod_node_sha"${nodeExecutable}; ` +
    '[ -x "$topod_runtime" ] || exit 78; '
  )
}

/** Keeps address space small under RLIMIT_AS: undici's WASM memory otherwise reserves 4-9 GiB (#37538).
 * Caps any WASM memory in topod at 64 MiB. Pinned Node only: older host Node rejects the flag. */
const TOPOD_PINNED_NODE_FLAGS = '--disable-wasm-trap-handler --wasm-max-mem-pages=1024'

/** Also sets $topod_runtime_flags. Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectTopodSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixTopodHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, TOPOD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(joinRemotePath(host, directory, topodBunRuntimeFilename(host.os)))
  const target = quotePosixShell(joinRemotePath(host, directory, TOPOD_BUILD_TARGET_FILENAME))
  return (
    // One compound command: launch chains it with && after cd.
    `if [ -e ${nodeMarker} ]; then ${topodNodeSlotRuntimeCommand(host, directory)}` +
    `topod_runtime_flags=${quotePosixShell(TOPOD_PINNED_NODE_FLAGS)}; ` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; topod_runtime=${runtime}; topod_runtime_flags=; ` +
    `else topod_runtime=${quotePosixShell(legacyNodePath)}; topod_runtime_flags=; fi`
  )
}
