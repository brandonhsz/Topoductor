import * as z from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../transport/rpc/rpc-operation-result-reader'

export const remoteDesktopWriteRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'remote-desktop.write',
    method: 'remoteDesktop.write',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('remote-desktop-written', z.object({ written: z.boolean() }))
  })
)
