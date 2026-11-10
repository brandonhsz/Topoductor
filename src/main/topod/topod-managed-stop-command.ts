// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  TOPOD_CANCEL_MANAGED_STOP_FLAG,
  TOPOD_COMPLETE_MANAGED_STOP_FLAG,
  TOPOD_MANAGED_STOP_REQUEST_FILE_FLAG,
  TopodManagedStopRequestSchema,
  type TopodManagedStopCancellation,
  type TopodManagedStopCompletion,
  type TopodManagedStopRequest
} from '../../shared/topod-stop-request'
import { cancelTopodManagedStop } from './topod-managed-stop-cancellation'
import { readTopodCompletedStopReceipt } from './topod-completed-stop-receipt'
import { readTopodManagedStopRequest } from './topod-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeTopodManagedStop,
  type TopodManagedStopCompletionOptions
} from './topod-managed-stop-completion'

export async function runTopodManagedStopCommand(
  argv: readonly string[],
  options: TopodManagedStopCompletionOptions = {}
): Promise<TopodManagedStopCompletion> {
  const request = parseRequestArgument(argv, TOPOD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeTopodManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readTopodCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: TopodManagedStopCompletion = {
    ...request,
    kind: 'topod_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runTopodManagedStopCancelCommand(
  argv: readonly string[]
): TopodManagedStopCancellation {
  const request = parseRequestArgument(argv, TOPOD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: TopodManagedStopCancellation = {
    ...request,
    kind: 'topod_managed_stop_cancellation',
    outcome: cancelTopodManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): TopodManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('topod_managed_stop_invalid_arguments')
  }
  if (argv[1] === TOPOD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('topod_managed_stop_invalid_arguments')
    }
    return readTopodManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('topod_managed_stop_invalid_arguments')
  }
  return TopodManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const TOPOD_MANAGED_STOP_EXIT_VERDICT = 0
export const TOPOD_MANAGED_STOP_EXIT_FAILED = 1
export const TOPOD_MANAGED_STOP_EXIT_USAGE = 64

export async function runTopodManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = TOPOD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === TOPOD_CANCEL_MANAGED_STOP_FLAG) {
      runTopodManagedStopCancelCommand(argv)
    } else {
      await runTopodManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('topod: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'topod_managed_stop_invalid_arguments')
        ? TOPOD_MANAGED_STOP_EXIT_USAGE
        : TOPOD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
