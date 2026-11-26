#!/usr/bin/env node
// Usage: node scripts/ota-deploy.mjs <ios|android|all> [extra hot-updater deploy flags, e.g. -f -m "msg"]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const mobileRoot = join(import.meta.dirname, '..')
const [platform, ...extraArgs] = process.argv.slice(2)

if (!['ios', 'android', 'all'].includes(platform)) {
  console.error('Usage: pnpm ota:<ios|android> [-f] [-m "message"] [-r 50] [-c channel]')
  process.exit(1)
}

// Same files Expo inlines EXPO_PUBLIC_* from; an OTA bundle without them would silently disable future OTAs.
for (const file of ['.env.local', '.env']) {
  const path = join(mobileRoot, file)
  if (existsSync(path)) {
    process.loadEnvFile(path)
  }
}
const missing = ['EXPO_PUBLIC_HOT_UPDATER_BASE_URL', 'EXPO_PUBLIC_HOT_UPDATER_API_KEY'].filter(
  (name) => !process.env[name]
)
if (missing.length > 0) {
  console.error(
    `Refusing to deploy: ${missing.join(', ')} not set (mobile/.env.local or environment).`
  )
  process.exit(1)
}

const hasTarget = extraArgs.some((arg) => arg === '-t' || arg.startsWith('--target-app-version'))
// The release version (app.json) runs ahead of binaries via OTA, so target every binary since the last
// native change; raise otaMinNativeVersion whenever a native release changes native code.
const releaseVersion = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8')).expo.version
const { otaMinNativeVersion } = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8'))
const targetRange = `>=${otaMinNativeVersion} <=${releaseVersion}`
const args = [
  'hot-updater',
  'deploy',
  ...(platform === 'all' ? [] : ['-p', platform]),
  ...(hasTarget ? [] : ['-t', targetRange]),
  ...extraArgs
]

console.log(`> ${args.join(' ')}`)
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', ...args], {
  cwd: mobileRoot,
  stdio: 'inherit',
  env: process.env
})
process.exit(result.status ?? 1)
