import type { CommandHandler } from '../dispatch'
import {
  getOptionalNumberFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { callerParams, readCallerFile } from './harness-caller'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'
import {
  formatHarnessChatStatus,
  type HarnessChatStatus
} from '../../shared/harness/harness-chat-status'

type HarnessStartResult = { instructions: string; status: HarnessChatStatus }

const WAIT_SECONDS = 300
const WAIT_GRACE_MS = 15_000

async function outputOf(flags: Map<string, string | boolean>): Promise<string> {
  const file = getOptionalStringFlag(flags, 'output-file')
  const text = getOptionalStringFlag(flags, 'output')
  if (file) {
    return readCallerFile(file)
  }
  if (text) {
    return text
  }
  throw new RuntimeClientError('invalid_argument', 'Missing --output-file or --output.')
}

function show(result: RuntimeRpcSuccess<HarnessChatStatus>, json: boolean): void {
  printResult(result, json, formatHarnessChatStatus)
}

const SUBAGENT_MARKER = '[topo-harness-task:'
const SUMMARY_TAG = '<tools-used-before-summary>'
const FOREGROUND_REQUIRED =
  'Topo Harness: este paso necesita la respuesta final del subagente. Lánzalo otra vez en primer plano (run_in_background: false) con el mismo prompt.'

/** The subagent's own text: Claude prepends a tag block listing the tools it used. */
function subagentText(response: Record<string, unknown>): string {
  const content = Array.isArray(response.content) ? response.content : []
  return content
    .map((block: unknown) =>
      typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : ''
    )
    .filter((text) => text && !text.includes(SUMMARY_TAG))
    .join('\n')
}

function record(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

/** `--field key=value` pairs for a restart decision. */
function answerFields(flags: Map<string, string | boolean>): Record<string, string> | null {
  const pairs = getRepeatedStringFlag(flags, 'field')
    .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)])
    .filter(([key]) => key)
  return pairs.length > 0 ? Object.fromEntries(pairs) : null
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const HARNESS_HANDLERS: Record<string, CommandHandler> = {
  // Fails open: a hook that errors must never stop the agent.
  'harness guard': async ({ flags, client }) => {
    try {
      const payload: unknown = JSON.parse(await readStdin())
      const tool =
        typeof payload === 'object' && payload !== null && 'tool_name' in payload
          ? String(payload.tool_name)
          : ''
      if (!tool) {
        return
      }
      const result = await client.call<{ reason: string | null }>(
        'harness.guard',
        { ...callerParams(flags, client.isRemote), tool },
        { timeoutMs: 5_000 }
      )
      if (result.result.reason) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: result.result.reason
            }
          })
        )
      }
    } catch {
      // Allow: Topo may be closed or this is not a Harness workspace.
    }
  },
  // PostToolUse hook for the subagent tool; fails open like the guard.
  'harness capture': async ({ flags, client }) => {
    try {
      const payload = record(JSON.parse(await readStdin()))
      const prompt = String(record(payload.tool_input).prompt ?? '')
      if (!prompt.includes(SUBAGENT_MARKER)) {
        return
      }
      const response = record(payload.tool_response)
      if (response.status !== 'completed') {
        console.log(JSON.stringify({ decision: 'block', reason: FOREGROUND_REQUIRED }))
        return
      }
      const result = await client.call<{ taskId: string | null; reason: string | null }>(
        'harness.subagentResult',
        { ...callerParams(flags, client.isRemote), prompt, output: subagentText(response) },
        { timeoutMs: 5_000 }
      )
      if (result.result.reason) {
        console.log(JSON.stringify({ decision: 'block', reason: result.result.reason }))
      }
    } catch {
      // Topo may be closed; the chat sees the subagent's answer either way.
    }
  },
  'harness start': async ({ flags, client, json }) => {
    const result = await client.call<HarnessStartResult>('harness.start', {
      ...callerParams(flags, client.isRemote),
      flowId: getRequiredStringFlag(flags, 'flow'),
      fields: answerFields(flags) ?? {}
    })
    printResult(
      result,
      json,
      (started) => `${started.instructions}\n\n---\n\n${formatHarnessChatStatus(started.status)}`
    )
  },
  'harness status': async ({ flags, client, json }) => {
    show(
      await client.call<HarnessChatStatus>('harness.status', callerParams(flags, client.isRemote)),
      json
    )
  },
  'harness complete': async ({ flags, client, json }) => {
    const outcome = getOptionalStringFlag(flags, 'outcome')
    show(
      await client.call<HarnessChatStatus>('harness.complete', {
        ...callerParams(flags, client.isRemote),
        taskId: getRequiredStringFlag(flags, 'task'),
        output: await outputOf(flags),
        ...(outcome ? { outcome } : {})
      }),
      json
    )
  },
  'harness wait': async ({ flags, client, json }) => {
    const seconds = getOptionalNumberFlag(flags, 'timeout') ?? WAIT_SECONDS
    const timeoutMs = Math.min(600, Math.max(1, seconds)) * 1000
    show(
      await client.call<HarnessChatStatus>(
        'harness.wait',
        { ...callerParams(flags, client.isRemote), timeoutMs },
        { timeoutMs: timeoutMs + WAIT_GRACE_MS }
      ),
      json
    )
  },
  'harness answer': async ({ flags, client, json }) => {
    const choice = getOptionalStringFlag(flags, 'choice')
    const text = getOptionalStringFlag(flags, 'text')
    const fields = answerFields(flags)
    show(
      await client.call<HarnessChatStatus>('harness.answer', {
        ...callerParams(flags, client.isRemote),
        decisionId: getRequiredStringFlag(flags, 'decision'),
        ...(choice ? { choice } : {}),
        ...(text ? { text } : {}),
        ...(fields ? { fields } : {})
      }),
      json
    )
  }
}
