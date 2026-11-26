import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { authenticateRelease, HOST_RELEASE_KEYS } from '../src/main/homes/release'

// The real, published host-v0.1.0 manifest for linux-x64, as downloaded from the GitHub release.
const manifest = readFileSync(join(__dirname, 'fixtures', 'althar-host-0.1.0-linux-x64.json'))

describe('the pinned host release key', () => {
  it('verifies the published host-v0.1.0 manifest', () => {
    const release = authenticateRelease(manifest, HOST_RELEASE_KEYS, 'x64', Date.parse('2026-11-24T00:00:00Z'))
    expect(release.version).toBe('0.1.0')
    expect(release.url).toBe('https://github.com/AltharIDE/althar/releases/download/host-v0.1.0/althar-host-0.1.0-linux-x64.tar.gz')
    expect(release.key).toBe(HOST_RELEASE_KEYS[0])
  })

  it('rejects the manifest for another architecture', () => {
    expect(() => authenticateRelease(manifest, HOST_RELEASE_KEYS, 'arm64', Date.parse('2026-11-24T00:00:00Z'))).toThrow()
  })
})
