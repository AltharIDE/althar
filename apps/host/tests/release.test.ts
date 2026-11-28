import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import { isoAfter } from '@althar/testing'

import { authenticateRelease, compareVersions, releaseIdentity, verifyRelease, type ReleaseManifest } from '../src/updates/release'

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

describe('a worker release in parts', () => {
  const part = (name: string, path: string, url = `https://releases.example/${name}.tar.zst`) => ({
    name,
    path,
    agent: 'codex' as const,
    tree: 'c'.repeat(64),
    url,
    sha256: 'd'.repeat(64),
    bytes: 10,
    files: 1,
    unpackedBytes: 20,
  })
  const base = { url: 'https://releases.example/base.tar.gz', sha256: 'e'.repeat(64), bytes: 10, files: 1, unpackedBytes: 20 }
  const inParts = (of: ReadonlyArray<ReturnType<typeof part>>, first = base) => signed({ ...manifest, parts: { base: first, of } })

  it('takes its parts where each has a place of its own in node_modules, over HTTPS', () => {
    const verified = verify(inParts([part('codex', 'node_modules/@openai/codex-x'), part('claude', 'node_modules/@anthropic-ai/claude-x')]))
    expect(verified.manifest.parts?.of.map((one) => one.name)).toEqual(['codex', 'claude'])
  })

  it('refuses parts inside one another, twice in a place or by a name, outside node_modules, or over plain HTTP', () => {
    for (const of of [
      [part('codex', 'node_modules/@openai/codex-x'), part('rg', 'node_modules/@openai/codex-x/node_modules/rg')],
      [part('codex', 'node_modules/@openai/codex-x'), part('again', 'node_modules/@openai/codex-x')],
      [part('codex', 'node_modules/@openai/codex-x'), part('codex', 'node_modules/@openai/codex-y')],
      [part('codex', 'dist/codex')],
      [part('codex', 'node_modules/@openai/../../etc')],
      [part('codex', 'node_modules/@openai/codex-x', 'http://releases.example/codex.tar.zst')],
    ])
      expect(() => verify(inParts(of))).toThrow()
    expect(() =>
      verify(inParts([part('codex', 'node_modules/@openai/codex-x')], { ...base, url: 'http://releases.example/base.tar.gz' })),
    ).toThrow()
    expect(() => verify(inParts([]))).toThrow()
  })
})

describe('versions and envelopes, at their edges', () => {
  it('reads a version missing its patch as .0, either side', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
    expect(compareVersions('1.1', '1.2.0')).toBe(-1)
  })

  it('refuses a signature that isn’t written exactly as base64url', () => {
    const envelope = JSON.parse(signed().toString()) as { signature: string }
    const padded = Buffer.from(JSON.stringify({ ...envelope, signature: `${envelope.signature}==` }))
    expect(() => authenticateRelease(padded, [publicKey], 'x64')).toThrow()
    expect(authenticateRelease(signed(), [publicKey], 'x64').manifest.version).toBe(manifest.version)
  })
})
