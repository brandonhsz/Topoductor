import { z } from 'zod'

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(8080),
  TOPO_RELAY_FENCE_PROJECT: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
  TOPO_RELAY_FENCE_STATE_BUCKET: z.string().min(3).max(222),
  TOPO_RELAY_FENCE_LEASE_OBJECT: z.string().min(1).max(512),
  TOPO_RELAY_FENCE_DIRECTOR_ORIGIN: z.string().url(),
  TOPO_RELAY_FENCE_ADMIN_AUDIENCE: z.string().url(),
  TOPO_RELAY_FENCE_REQUESTER_SERVICE_ACCOUNT: z.string().email(),
  TOPO_RELAY_FENCE_RUNTIME_SERVICE_ACCOUNT: z.string().email(),
  TOPO_RELAY_FENCE_SOURCE_CELL_ID: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/),
  TOPO_RELAY_FENCE_FAILED_TARGET_CELL_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,127}$/),
  TOPO_RELAY_FENCE_REPLACEMENT_TARGET_CELL_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,127}$/),
  TOPO_RELAY_FENCE_IMAGE_COMMIT: z.string().regex(/^[a-f0-9]{40}$/),
  // Resolved against the broker's working directory, which the image sets to the copied tree root.
  TOPO_RELAY_FENCE_TERRAFORM_DIR: z.string().min(1).default('infra/terraform'),
  TOPO_RELAY_FENCE_UNOBSERVED_CONNECTION_BOUND: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(499),
  TOPO_RELAY_FENCE_CONNECTION_CEILING: z.coerce
    .number()
    .int()
    .positive()
    .max(600)
    .default(600)
})

export type RelayFenceBrokerConfig = {
  port: number
  project: string
  stateBucket: string
  leaseObject: string
  directorOrigin: string
  adminAudience: string
  requesterServiceAccount: string
  runtimeServiceAccount: string
  sourceCellId: string
  failedTargetCellId: string
  replacementTargetCellId: string
  imageCommit: string
  terraformDir: string
  unobservedConnectionBound: number
  connectionCeiling: number
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): RelayFenceBrokerConfig {
  const parsed = environmentSchema.parse(environment)
  const director = new URL(parsed.TOPO_RELAY_FENCE_DIRECTOR_ORIGIN)
  const audience = new URL(parsed.TOPO_RELAY_FENCE_ADMIN_AUDIENCE)
  if (
    director.origin !== parsed.TOPO_RELAY_FENCE_DIRECTOR_ORIGIN ||
    audience.origin !== director.origin ||
    audience.pathname !== '/v1/admin/drain' ||
    audience.search ||
    audience.hash
  ) {
    throw new Error('broker director and admin audience must use the canonical drain origin')
  }
  const cells = new Set([
    parsed.TOPO_RELAY_FENCE_SOURCE_CELL_ID,
    parsed.TOPO_RELAY_FENCE_FAILED_TARGET_CELL_ID,
    parsed.TOPO_RELAY_FENCE_REPLACEMENT_TARGET_CELL_ID
  ])
  if (cells.size !== 3) throw new Error('broker cells must be distinct')
  return {
    port: parsed.PORT,
    project: parsed.TOPO_RELAY_FENCE_PROJECT,
    stateBucket: parsed.TOPO_RELAY_FENCE_STATE_BUCKET,
    leaseObject: parsed.TOPO_RELAY_FENCE_LEASE_OBJECT,
    directorOrigin: parsed.TOPO_RELAY_FENCE_DIRECTOR_ORIGIN,
    adminAudience: parsed.TOPO_RELAY_FENCE_ADMIN_AUDIENCE,
    requesterServiceAccount: parsed.TOPO_RELAY_FENCE_REQUESTER_SERVICE_ACCOUNT,
    runtimeServiceAccount: parsed.TOPO_RELAY_FENCE_RUNTIME_SERVICE_ACCOUNT,
    sourceCellId: parsed.TOPO_RELAY_FENCE_SOURCE_CELL_ID,
    failedTargetCellId: parsed.TOPO_RELAY_FENCE_FAILED_TARGET_CELL_ID,
    replacementTargetCellId: parsed.TOPO_RELAY_FENCE_REPLACEMENT_TARGET_CELL_ID,
    imageCommit: parsed.TOPO_RELAY_FENCE_IMAGE_COMMIT,
    terraformDir: parsed.TOPO_RELAY_FENCE_TERRAFORM_DIR,
    unobservedConnectionBound:
      parsed.TOPO_RELAY_FENCE_UNOBSERVED_CONNECTION_BOUND,
    connectionCeiling: parsed.TOPO_RELAY_FENCE_CONNECTION_CEILING
  }
}
