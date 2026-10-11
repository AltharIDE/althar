import { describe, expect, it } from 'vitest'

import { withFile } from '../scripts/feed'
import { notaryArgs, notaryAuth } from '../scripts/notarize'

const FEED = `version: 0.1.0
files:
  - url: Althar-0.1.0-arm64-mac.zip
    sha512: zipdigest==
    size: 373254965
  - url: Althar-0.1.0-arm64.dmg
    sha512: dmgdigest==
    size: 373000535
path: Althar-0.1.0-arm64-mac.zip
sha512: zipdigest==
releaseDate: '2026-10-11T15:21:15.055Z'
`

describe('the release', () => {
  it('notarizes with an API key or a keychain profile, and refuses half a key rather than skipping', () => {
    expect(notaryAuth({})).toBeNull()
    expect(notaryAuth({ APPLE_API_KEY: ' ', APPLE_KEYCHAIN_PROFILE: '' })).toBeNull()
    expect(() => notaryAuth({ APPLE_API_KEY: '/keys/AuthKey_ABC.p8', APPLE_API_KEY_ID: 'ABC' })).toThrow(/APPLE_API_ISSUER not set/)
    const key = notaryAuth({ APPLE_API_KEY: '/keys/AuthKey_ABC.p8', APPLE_API_KEY_ID: 'ABC', APPLE_API_ISSUER: 'issuer-id' })
    expect(key === null ? [] : notaryArgs(key)).toEqual(['--key', '/keys/AuthKey_ABC.p8', '--key-id', 'ABC', '--issuer', 'issuer-id'])
    const profile = notaryAuth({ APPLE_KEYCHAIN_PROFILE: 'althar-notary', APPLE_KEYCHAIN: '/tmp/build.keychain-db' })
    expect(profile === null ? [] : notaryArgs(profile)).toEqual([
      '--keychain-profile',
      'althar-notary',
      '--keychain',
      '/tmp/build.keychain-db',
    ])
  })

  it('writes the stapled dmg’s digest and size into the feed, and leaves the zip the updater reads alone', () => {
    const fed = withFile(FEED, 'Althar-0.1.0-arm64.dmg', 'stapled==', 373001000)
    expect(fed).toContain('  - url: Althar-0.1.0-arm64.dmg\n    sha512: stapled==\n    size: 373001000\n')
    expect(fed).toContain('  - url: Althar-0.1.0-arm64-mac.zip\n    sha512: zipdigest==\n    size: 373254965\n')
    expect(fed).toContain('path: Althar-0.1.0-arm64-mac.zip\nsha512: zipdigest==\n')
    expect(() => withFile(FEED, 'Althar-0.1.1-arm64.dmg', 'x', 1)).toThrow(/no entry/)
  })
})
