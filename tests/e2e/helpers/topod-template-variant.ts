// Change only template build identity to model an app update bundling a newer topod.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  TOPOD_TEMPLATE_MANIFEST_FILENAME,
  TOPOD_VERSION
} from '../../../src/shared/topod-artifacts'

const ENTRY = 'topod.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeTopodTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// topod e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, TOPOD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostTopodActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.topo-remote/topod-active.json"'))
}

export function isTopodFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${TOPOD_VERSION}+`)
}
