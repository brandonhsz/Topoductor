export function requestUpdateInstall(onError: (message: string) => void): void {
  void window.api.updater.quitAndInstall().catch((error: unknown) => {
    onError(String((error as Error)?.message ?? error))
  })
}
