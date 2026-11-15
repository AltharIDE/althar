import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseOptions } from '../src/options'
import { packageRelease } from '../src/updates/publish'
import { authenticateRelease, digest } from '../src/updates/release'
import { inspectArchive } from '../src/updates/archive'
import { releaseInfo } from '../src/updates/info'
import { fixtureFiles, NOW } from './updateFixture'
import { temporary } from './support'

describe('signed host release production', () => {
  it('packages a verified immutable archive and exact signed metadata without including the signing key', async () => {
    const root = temporary()
    const pair = generateKeyPairSync('ed25519')
    const signingKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const options = parseOptions(
      [
        'package-release',
        '--release-base-url',
        'https://releases.example/host-v0.1.0',
        '--release-sequence',
        '1',
        '--output',
        join(root, 'out'),
      ],
      {},
      root,
    )
    const dependencies = {
      source: { node: '/fixture/node', entry: '/fixture/entry', version: releaseInfo().version },
      signingKey,
      now: NOW,
      assemble: async (_: unknown, folder: string) => {
        fixtureFiles(folder)
      },
      execute: async () => JSON.stringify(releaseInfo()),
    }
    const result = await packageRelease(options, dependencies)
    const envelope = readFileSync(result.manifest)
    const verified = authenticateRelease(envelope, [publicKey], releaseInfo().arch)
    const archive = readFileSync(result.archive)
    expect(verified.manifest.archive.sha256).toBe(digest(archive))
    expect(verified.manifest.archive.bytes).toBe(archive.length)
    expect(envelope.toString()).not.toContain(signingKey)
    await inspectArchive(result.archive, verified.manifest)
    await expect(packageRelease(options, dependencies)).rejects.toThrow()
  })

  it('requires a protected Ed25519 signing key and explicit release metadata', async () => {
    const root = temporary()
    const options = parseOptions(['package-release'], {}, root)
    await expect(
      packageRelease(options, { source: { node: '/node', entry: '/entry', version: '0.1.0' }, signingKey: undefined }),
    ).rejects.toMatchObject({ code: 'UpdateNotConfigured' })
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await expect(
      packageRelease(
        { ...options, releaseBaseURL: 'https://updates.example', releaseSequence: 1 },
        { source: { node: '/node', entry: '/entry', version: '0.1.0' }, signingKey: rsa },
      ),
    ).rejects.toThrow()
  })
})
