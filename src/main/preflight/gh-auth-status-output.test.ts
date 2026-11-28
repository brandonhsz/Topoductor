import { describe, expect, it } from 'vitest'
import { ghAuthStatusOutputIsSignedIn } from './gh-auth-status-output'

describe('ghAuthStatusOutputIsSignedIn', () => {
  it('accepts a working login that exited nonzero', () => {
    expect(
      ghAuthStatusOutputIsSignedIn(
        'github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Active account: true\n'
      )
    ).toBe(true)
  })

  it('rejects a revoked token that gh still lists as the active account', () => {
    expect(
      ghAuthStatusOutputIsSignedIn(
        'github.com\n  X Failed to log in to github.com account octo (default)\n  - Active account: true\n  - The token in default is invalid.\n'
      )
    ).toBe(false)
  })

  it('rejects output without a login', () => {
    expect(ghAuthStatusOutputIsSignedIn('You are not logged into any GitHub hosts.')).toBe(false)
  })
})
