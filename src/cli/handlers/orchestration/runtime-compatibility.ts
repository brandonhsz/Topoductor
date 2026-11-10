import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'topo' | 'topo-ide' | 'topo-dev' {
  const configured = process.env.TOPO_CLI_COMMAND
  if (configured === 'topo' || configured === 'topo-ide' || configured === 'topo-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'topo-ide' : 'topo'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'topo' | 'topo-ide' | undefined {
  if (process.env.TOPO_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.TOPO_CLI_COMMAND
  if (command === 'topo' || command === 'topo-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Topo launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.TOPO_DEV_CLI_INVOCATION === '1' ||
    (process.env.TOPO_USER_DATA_PATH?.includes('topo-dev') ?? false)
  )
}
