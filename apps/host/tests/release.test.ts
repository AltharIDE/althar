import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import { isoAfter } from '@althar/testing'

import { releaseIdentity, verifyRelease, type ReleaseManifest } from '../src/updates/release'

const pair = generateKeyPairSync('ed25519')
const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
const now = Date.parse('2026-11-15T12:00:00Z')
const manifest: ReleaseManifest = {
  format: 1,
  version: '0.1.1',
  sequence: 2,
  publishedAt: '2026-11-15T00:00:00Z',
  expiresAt: isoAfter(90 * 86_400_000, now),
  platform: 'linux',
  arch: 'x64',
  updaterProtocol: 1,
  apiVersion: 1,
  storage: 'a'.repeat(64),
  archive: { url: 'https://releases.example/host.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
  unpackedBytes: 200,
  files: 2,
}
const signed = (value: unknown = manifest) => {
  const payload = Buffer.from(JSON.stringify(value))
  return Buffer.from(
    JSON.stringify({
      format: 1,
      keyId: releaseIdentity(publicKey),
      payload: payload.toString('base64url'),
      signature: sign(null, payload, pair.privateKey).toString('base64url'),
    }),
  )
}
const verify = (bytes = signed(), extra: { minimumSequence?: number; installedVersion?: string; arch?: 'x64' | 'arm64' } = {}) =>
  verifyRelease(bytes, {
    keys: [publicKey],
    now,
    arch: extra.arch ?? 'x64',
    minimumSequence: extra.minimumSequence ?? 1,
    installedVersion: extra.installedVersion ?? '0.1.0',
  })

describe('a worker’s own release, beside the home’s', () => {
  const policy = { keys: [publicKey], now, arch: 'x64' as const, minimumSequence: 2, installedVersion: '0.1.1' }
  const worker = signed({ ...manifest, product: 'worker' })

  it('is taken only where a worker’s is asked for, and a home’s only where a home’s is', () => {
    expect(verifyRelease(worker, { ...policy, minimumSequence: 1, installedVersion: '0.1.0', product: 'worker' }).manifest.product).toBe(
      'worker',
    )
    expect(() => verifyRelease(worker, { ...policy, minimumSequence: 1, installedVersion: '0.1.0' })).toThrow()
    expect(() => verifyRelease(signed(), { ...policy, minimumSequence: 1, installedVersion: '0.1.0', product: 'worker' })).toThrow()
    expect(() =>
      verifyRelease(signed({ ...manifest, product: 'home' }), { ...policy, minimumSequence: 1, installedVersion: '0.1.0' }),
    ).toThrow()
  })

  it('may be the very release installed only where a worker moves onto its own, and never an older one', () => {
    expect(() => verifyRelease(worker, { ...policy, product: 'worker' })).toThrow()
    expect(verifyRelease(worker, { ...policy, product: 'worker', sameRelease: true }).manifest.version).toBe('0.1.1')
    expect(() => verifyRelease(worker, { ...policy, product: 'worker', sameRelease: true, minimumSequence: 3 })).toThrow()
    expect(() => verifyRelease(worker, { ...policy, product: 'worker', sameRelease: true, installedVersion: '0.1.2' })).toThrow()
  })
})

describe('authenticated host releases', () => {
  it('authenticates exact manifest bytes against an explicitly pinned Ed25519 key', () => {
    expect(verify().manifest).toEqual(manifest)
    expect(verify().id).toMatch(/^[a-f0-9]{64}$/)
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString()
    expect(() => verifyRelease(signed(), { keys: [other], now, arch: 'x64', minimumSequence: 0, installedVersion: '0.0.0' })).toThrow()
    const envelope: unknown = JSON.parse(signed().toString())
    if (typeof envelope !== 'object' || envelope === null) throw new Error('Missing fixture envelope')
    expect(() =>
      verify(
        Buffer.from(
          JSON.stringify({ ...envelope, payload: Buffer.from(JSON.stringify({ ...manifest, version: '9.9.9' })).toString('base64url') }),
        ),
      ),
    ).toThrow()
  })

  it('rejects replay, downgrade, expired/future releases, wrong targets and unknown updater protocols', () => {
    expect(() => verify(signed(), { minimumSequence: 2 })).toThrow()
    expect(() => verify(signed(), { installedVersion: '1.0.0' })).toThrow()
    expect(() => verify(signed(), { arch: 'arm64' })).toThrow()
    for (const changed of [
      { expiresAt: isoAfter(-86_400_000, now) },
      { publishedAt: isoAfter(86_400_000, now) },
      { expiresAt: 'not an ISO timestamp' },
      { expiresAt: isoAfter(367 * 86_400_000, now) },
      { updaterProtocol: 2 },
      { version: '01.1.1' },
      { platform: 'darwin' },
      { archive: { ...manifest.archive, url: 'http://insecure.example/release' } },
      { archive: { ...manifest.archive, bytes: 3_000_000_000 } },
    ])
      expect(() => verify(signed({ ...manifest, ...changed }))).toThrow()
  })

  it('bounds and validates untrusted envelopes before processing payloads', () => {
    for (const bytes of [Buffer.alloc(100_000), Buffer.from('not JSON'), Buffer.from('{}'), Buffer.from('{"format":2}')])
      expect(() => verify(bytes)).toThrow()
    expect(() =>
      releaseIdentity(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'pem', type: 'spki' }).toString()),
    ).toThrow()
  })
})
