import { describe, expect, it } from 'vitest'
import { TopodBindAddressError, resolveTopodBindHost } from './topod-bind-address'

describe('resolveTopodBindHost', () => {
  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveTopodBindHost('internal.example')).toThrow(TopodBindAddressError)
    expect(() => resolveTopodBindHost('')).toThrow(TopodBindAddressError)
    expect(() => resolveTopodBindHost('0.0.0.0:80')).toThrow(TopodBindAddressError)
    expect(() => resolveTopodBindHost('fe80::2008%eth0')).toThrow(
      'does not support scoped IPv6 addresses'
    )
  })
})
