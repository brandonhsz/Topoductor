import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { normalizeHarnessFlow } from '../../shared/harness/harness-flow-normalize'
import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import {
  createHarnessExampleFlow,
  HARNESS_EXAMPLE_FLOW_ID,
  HARNESS_EXAMPLE_FLOW_VERSION
} from '../../shared/harness/harness-example-flow'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'

type FlowsFile = {
  version: 1
  seeded: boolean
  /** Example revision last written, and its `updatedAt` then (to tell whether it was edited). */
  exampleVersion: number
  exampleSeededAt: number | null
  flows: HarnessFlow[]
}

const MAX_BYTES = 8 * 1024 * 1024
const MAX_FLOWS = 200

function flowsPath(): string {
  return join(getAppEnvironment().getPath('userData'), 'harness-flows.json')
}

function isMissing(error: unknown): boolean {
  return asRecord(error)?.code === 'ENOENT'
}

/** Null means unreadable, never empty: rewriting it would drop every saved flow. */
async function readFlowsFile(): Promise<FlowsFile | null> {
  const path = flowsPath()
  try {
    if ((await stat(path)).size > MAX_BYTES) {
      return null
    }
    const parsed = asRecord(JSON.parse(await readFile(path, 'utf8')))
    if (parsed?.version !== 1 || !Array.isArray(parsed.flows)) {
      return null
    }
    return {
      version: 1,
      seeded: parsed.seeded === true,
      exampleVersion: typeof parsed.exampleVersion === 'number' ? parsed.exampleVersion : 1,
      exampleSeededAt: typeof parsed.exampleSeededAt === 'number' ? parsed.exampleSeededAt : null,
      flows: parsed.flows
        .map(normalizeHarnessFlow)
        .filter((flow): flow is HarnessFlow => flow !== null)
    }
  } catch (error) {
    return isMissing(error)
      ? { version: 1, seeded: false, exampleVersion: 0, exampleSeededAt: null, flows: [] }
      : null
  }
}

let queue: Promise<unknown> = Promise.resolve()

/** Serializes read-modify-write so two saves never drop each other's flow. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

/** Seeds the example once, and upgrades it later only when the person never edited it. */
function withCurrentExample(file: FlowsFile): FlowsFile | null {
  if (file.seeded && file.exampleVersion >= HARNESS_EXAMPLE_FLOW_VERSION) {
    return null
  }
  const now = Date.now()
  const example = createHarnessExampleFlow(now)
  const stored = file.flows.find((flow) => flow.id === HARNESS_EXAMPLE_FLOW_ID)
  const others = file.flows.filter((flow) => flow.id !== HARNESS_EXAMPLE_FLOW_ID)
  const upgraded = { ...file, seeded: true, exampleVersion: HARNESS_EXAMPLE_FLOW_VERSION }
  if (file.seeded && !stored) {
    return upgraded
  }
  if (!stored || stored.updatedAt === file.exampleSeededAt) {
    return { ...upgraded, exampleSeededAt: now, flows: [example, ...others] }
  }
  if (file.exampleSeededAt === null) {
    // Files from before edit tracking: keep the old copy under its own id rather than guess.
    const previous = {
      ...stored,
      id: `${HARNESS_EXAMPLE_FLOW_ID}-anterior`,
      name: `${stored.name} (versión anterior)`
    }
    return { ...upgraded, exampleSeededAt: now, flows: [example, previous, ...others] }
  }
  return upgraded
}

async function loadSeeded(): Promise<FlowsFile | null> {
  const file = await readFlowsFile()
  if (!file) {
    return null
  }
  const next = withCurrentExample(file)
  if (!next) {
    return file
  }
  writeSecureJsonFile(flowsPath(), next)
  return next
}

/** Global flows plus the overrides of `repoId`; an override hides the global flow it was copied from. */
export function listHarnessFlows(repoId: string | null): Promise<HarnessFlow[]> {
  return serialized(async () => {
    const flows = (await loadSeeded())?.flows ?? []
    const overrides = repoId
      ? flows.filter((flow) => flow.scope.kind === 'repo' && flow.scope.repoId === repoId)
      : []
    const hidden = new Set(overrides.map((flow) => flow.basedOnFlowId).filter(Boolean))
    const globals = flows.filter((flow) => flow.scope.kind === 'global' && !hidden.has(flow.id))
    return [...overrides, ...globals]
  })
}

export function getHarnessFlow(flowId: string): Promise<HarnessFlow | null> {
  return serialized(
    async () => (await loadSeeded())?.flows.find((flow) => flow.id === flowId) ?? null
  )
}

export function saveHarnessFlow(raw: unknown): Promise<HarnessFlow> {
  return serialized(async () => {
    const file = await loadSeeded()
    if (!file) {
      throw new Error('Harness flows file exists but could not be read; refusing to overwrite it')
    }
    const flow = normalizeHarnessFlow(raw)
    if (!flow) {
      throw new Error('Invalid harness flow')
    }
    const saved = { ...flow, updatedAt: Date.now() }
    const others = file.flows.filter((existing) => existing.id !== saved.id)
    if (others.length >= MAX_FLOWS) {
      throw new Error(`Harness supports up to ${MAX_FLOWS} flows`)
    }
    writeSecureJsonFile(flowsPath(), { ...file, flows: [...others, saved] })
    return saved
  })
}

export function deleteHarnessFlow(flowId: string): Promise<void> {
  return serialized(async () => {
    const file = await loadSeeded()
    if (file) {
      writeSecureJsonFile(flowsPath(), {
        ...file,
        flows: file.flows.filter((flow) => flow.id !== flowId)
      })
    }
  })
}
