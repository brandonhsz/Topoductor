import { describe, expect, it } from 'vitest'
import { TOPOD_MOBILE_WEB_MANIFEST, topodMobileWebAssetFilenames } from './topod-artifacts'

describe('standalone runtime artifacts', () => {
  it.each([
    ['no assets', { assets: [] }],
    ['a traversal path', { assets: [{ path: '../topod.js' }] }],
    ['an absolute path', { assets: [{ path: '/etc/passwd' }] }],
    ['a backslash path', { assets: [{ path: 'a\\b.js' }] }],
    ['a missing path', { assets: [{}] }]
  ])('refuses a page manifest with %s', (_label, manifest) => {
    expect(() => topodMobileWebAssetFilenames(JSON.stringify(manifest))).toThrow(
      TOPOD_MOBILE_WEB_MANIFEST
    )
  })
})
