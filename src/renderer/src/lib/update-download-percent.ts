export function clampUpdateDownloadPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)))
}
