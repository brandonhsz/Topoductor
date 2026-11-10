import { describe, expect, it } from 'vitest'
import {
  isRecoverableRemoteRuntimeConnectionError,
  isRuntimeRpcQueueOverloadError,
  toRemoteRuntimeClientErrorLike
} from './remote-runtime-client-error-classification'

describe('remote runtime client error classification', () => {
  it('trusts a structured recovery code before legacy message fragments', () => {
    expect(
      isRecoverableRemoteRuntimeConnectionError({
        code: 'unauthorized',
        message: 'Remote Topo runtime closed the connection.'
      })
    ).toBe(false)
  })

  it('trusts a structured queue code before legacy message fragments', () => {
    expect(
      isRuntimeRpcQueueOverloadError({
        code: 'remote_runtime_unavailable',
        message: 'Remote runtime call queue is full; retry after current calls finish.'
      })
    ).toBe(false)
  })

  it.each([
    'Could not connect to the remote Topo runtime.',
    'Remote Topo runtime closed the connection.',
    'Remote Topo runtime connection closed.',
    'Remote Topo runtime is not connected.',
    "Error invoking remote method 'runtimeEnvironments:call': RuntimeRpcCallQueueOverloadError: Remote runtime call queue is full; retry after current calls finish.",
    'Remote runtime subscription closed before it started.',
    "Error invoking remote method 'runtimeEnvironments:call': Error: Remote runtime request limit reached; retry after pending requests finish."
  ])('normalizes unstructured connection failure: %s', (message) => {
    const error = toRemoteRuntimeClientErrorLike(new Error(message))
    expect(isRecoverableRemoteRuntimeConnectionError(error)).toBe(true)
  })
})
