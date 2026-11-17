import { z } from 'zod'

const MAX_OUTPUT = 256 * 1024

/** The calling chat names itself by session id (chats) or worktree id (terminals). */
const HarnessCaller = z.object({
  sessionId: z.string().min(1).max(256).optional(),
  worktreeId: z.string().min(1).max(4096).optional()
})

export const HarnessStatusParams = HarnessCaller.strict()

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
  text: z.string().max(MAX_OUTPUT).optional()
}).strict()
