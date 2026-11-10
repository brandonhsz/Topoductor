import type {
  TopoCloudCapabilities,
  TopoCloudOrgSummary,
  TopoProfileCloudSummary
} from '../../shared/topo-profiles'

export type TopoCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: TopoProfileCloudSummary
  organizations?: TopoCloudOrgSummary[]
  capabilities: TopoCloudCapabilities
}
