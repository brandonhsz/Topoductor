export function computerProviderUnavailableMessage(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return [
      'computer-use has no native provider for darwin because Topo Computer Use.app was not found or this macOS version is unsupported.',
      'For local development, run pnpm build:computer-macos and restart Topo from this worktree.'
    ].join(' ')
  }
  if (platform === 'linux' || platform === 'win32') {
    const runtime =
      platform === 'linux' ? 'computer-use-linux/runtime.py' : 'computer-use-windows/runtime.ps1'
    return `Computer use isn't available on this host: its Topo install has no ${runtime}. On a Topo server installed before computer use shipped with it, update or reprovision the server.`
  }
  return `computer-use has no native provider for ${platform}`
}
