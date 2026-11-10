/** Login profiles can put global Topo ahead on PATH; absolute TOPO_CLI_COMMAND must still reach this app. zsh runs in the real-shell lane. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createLoginShellHarness,
  type LoginShellHarness
} from './structured-session-login-shell-test-harness'

describe.runIf(process.platform !== 'win32')('a structured session in a bash login shell', () => {
  let harness: LoginShellHarness

  beforeEach(() => {
    harness = createLoginShellHarness()
  })

  afterEach(() => {
    harness.dispose()
  })

  it("resolves this app's CLI through TOPO_CLI_COMMAND in `bash -lc`", async () => {
    // Positive control: the profile really does put the global install first for a bare name.
    expect(await harness.run({ program: '/bin/bash', args: ['-lc', 'topo'] })).toBe('global')
    expect(await harness.run({ program: '/bin/bash', args: ['-lc', '"$TOPO_CLI_COMMAND"'] })).toBe(
      'app'
    )
  })
})
