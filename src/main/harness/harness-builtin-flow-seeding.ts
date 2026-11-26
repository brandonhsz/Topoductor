import { HARNESS_EXAMPLE_FLOW_ID } from '../../shared/harness/harness-example-flow'
import {
  HARNESS_BUILTIN_FLOWS,
  type HarnessBuiltinFlow
} from '../../shared/harness/harness-builtin-flows'
import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'

/** Revision of a built-in flow last written, and its `updatedAt` then (to tell whether it was edited). */
export type HarnessBuiltinSeed = { version: number; seededAt: number | null }

export type HarnessSeedFile = {
  seeded: boolean
  /** The first built-in keeps its legacy top-level fields so older builds still read the file. */
  exampleVersion: number
  exampleSeededAt: number | null
  builtins: Record<string, HarnessBuiltinSeed>
  flows: HarnessFlow[]
}

export function readBuiltinSeeds(value: unknown): Record<string, HarnessBuiltinSeed> {
  return Object.fromEntries(
    Object.entries(asRecord(value) ?? {}).flatMap(([id, raw]) => {
      const seed = asRecord(raw)
      return typeof seed?.version === 'number'
        ? [
            [
              id,
              {
                version: seed.version,
                seededAt: typeof seed.seededAt === 'number' ? seed.seededAt : null
              }
            ]
          ]
        : []
    })
  )
}

function seedOf(file: HarnessSeedFile, id: string): HarnessBuiltinSeed | null {
  if (id === HARNESS_EXAMPLE_FLOW_ID) {
    return file.seeded ? { version: file.exampleVersion, seededAt: file.exampleSeededAt } : null
  }
  return file.builtins[id] ?? null
}

function withSeed<F extends HarnessSeedFile>(file: F, id: string, seed: HarnessBuiltinSeed): F {
  return id === HARNESS_EXAMPLE_FLOW_ID
    ? { ...file, seeded: true, exampleVersion: seed.version, exampleSeededAt: seed.seededAt }
    : { ...file, builtins: { ...file.builtins, [id]: seed } }
}

/** Seeds a built-in once, and upgrades it later only when the person never edited it. */
function withCurrentBuiltin<F extends HarnessSeedFile>(
  file: F,
  builtin: HarnessBuiltinFlow,
  now: number
): F | null {
  const seed = seedOf(file, builtin.id)
  if (seed && seed.version >= builtin.version) {
    return null
  }
  const stored = file.flows.find((flow) => flow.id === builtin.id)
  const others = file.flows.filter((flow) => flow.id !== builtin.id)
  const fresh = { version: builtin.version, seededAt: now }
  if (seed && !stored) {
    return withSeed(file, builtin.id, { ...seed, version: builtin.version })
  }
  if (!stored || stored.updatedAt === seed?.seededAt) {
    return withSeed({ ...file, flows: [builtin.create(now), ...others] }, builtin.id, fresh)
  }
  if (!seed || seed.seededAt === null) {
    // Files from before edit tracking: keep the old copy under its own id rather than guess.
    const previous = {
      ...stored,
      id: `${builtin.id}-anterior`,
      name: `${stored.name} (versión anterior)`
    }
    return withSeed(
      { ...file, flows: [builtin.create(now), previous, ...others] },
      builtin.id,
      fresh
    )
  }
  return withSeed(file, builtin.id, { ...seed, version: builtin.version })
}

/** Null when every built-in is current, so the file is not rewritten. */
export function withCurrentBuiltins<F extends HarnessSeedFile>(file: F, now: number): F | null {
  let next: F | null = null
  // Reversed so freshly seeded built-ins end up listed in catalog order.
  for (const builtin of HARNESS_BUILTIN_FLOWS.toReversed()) {
    next = withCurrentBuiltin(next ?? file, builtin, now) ?? next
  }
  return next
}
