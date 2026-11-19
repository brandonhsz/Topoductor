import { defineMethod } from '../../core'
import {
  HarnessFlowsGetParams,
  HarnessFlowsListParams,
  HarnessFlowsSaveParams
} from '../../../../../shared/rpc-contract/harness-flow-params'
import type {
  HarnessFlowListItem,
  HarnessFlowReading,
  HarnessFlowSaveResult
} from '../../../../../shared/harness/harness-flow-version-types'

function notImplemented(): never {
  throw new Error('not_implemented')
}

export const HARNESS_FLOW_METHODS = [
  defineMethod({
    name: 'harness.flows.list',
    permission: 'workspace',
    params: HarnessFlowsListParams,
    handler: async (): Promise<HarnessFlowListItem[]> => notImplemented()
  }),
  defineMethod({
    name: 'harness.flows.get',
    permission: 'workspace',
    params: HarnessFlowsGetParams,
    handler: async (): Promise<HarnessFlowReading> => notImplemented()
  }),
  defineMethod({
    name: 'harness.flows.save',
    permission: 'workspace',
    params: HarnessFlowsSaveParams,
    handler: async (): Promise<HarnessFlowSaveResult> => notImplemented()
  })
]
