import { z } from 'zod'

const MAX_OUTPUT = 256 * 1024

/** The calling chat names itself by session id (chats) or worktree id (terminals). */
export const HarnessCaller = z.object({
  sessionId: z.string().min(1).max(256).optional(),
  worktreeId: z.string().min(1).max(4096).optional()
})

export const HarnessStatusParams = HarnessCaller.strict()

/** Starts a chat-driven run in the caller's workspace, e.g. from a scheduled automation. */
export const HarnessStartParams = HarnessCaller.extend({
  flowId: z.string().min(1).max(256),
  fields: z.record(z.string().min(1).max(64), z.string().max(MAX_OUTPUT)).optional()
}).strict()

export const HarnessCompleteParams = HarnessCaller.extend({
  taskId: z.string().min(1).max(256),
  output: z.string().max(MAX_OUTPUT),
  outcome: z.string().max(256).optional()
}).strict()

export const HarnessWaitParams = HarnessCaller.extend({
  timeoutMs: z.number().int().min(1_000).max(600_000).optional()
}).strict()

export const HarnessGuardParams = HarnessCaller.extend({
  tool: z.string().min(1).max(256)
}).strict()

export const HarnessAnswerParams = HarnessCaller.extend({
  decisionId: z.string().min(1).max(256),
  choice: z.string().max(256).optional(),
  text: z.string().max(MAX_OUTPUT).optional(),
  /** Start-field values for a restart decision; without them `text` fills the first required field. */
  fields: z.record(z.string().min(1).max(64), z.string().max(MAX_OUTPUT)).optional()
}).strict()

/** Sent by the PostToolUse capture hook after the chat's subagent tool returns. */
export const HarnessSubagentResultParams = HarnessCaller.extend({
  prompt: z.string().max(MAX_OUTPUT),
  output: z.string().max(MAX_OUTPUT)
}).strict()
