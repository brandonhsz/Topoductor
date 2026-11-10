import {
  TOPOD_NODE_RUNTIME_DIR_PREFIX,
  TOPOD_NODE_RUNTIME_POSIX_EXECUTABLE,
  TOPOD_RUNTIMES_DIRNAME
} from '../../../shared/topod-artifacts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from './remote-install-root'
import { TOPOD_MACHINE_HOMES_DIRNAME } from '../host-state/topod-machine-home'

/** POSIX shell glob words for topod's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function topodPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${TOPOD_RUNTIMES_DIRNAME}/${TOPOD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${TOPOD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${TOPOD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
