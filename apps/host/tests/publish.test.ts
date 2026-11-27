import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    rmSync(result.archive)
    await expect(packageRelease(options, dependencies)).rejects.toThrow('already holds a release manifest')
  })

  it('signs a worker’s own release beside the home’s, where it has a worker to carry, and checks what it says it is', async () => {
    const root = temporary()
    const pair = generateKeyPairSync('ed25519')
    const signingKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const options = (out: string) =>
      parseOptions(
        [
          'package-release',
          '--release-base-url',
          'https://releases.example/host-v0.1.0',
          '--release-sequence',
          '4',
          '--output',
          join(root, out),
        ],
        {},
        root,
      )
    const ran: Array<ReadonlyArray<string>> = []
    const dependencies = (says: string) => ({
      source: {
        node: '/fixture/node',
        entry: '/fixture/entry',
        version: releaseInfo().version,
        worker: '/fixture/althar-worker',
        workerTools: '/fixture/tools',
        workerEntry: '/fixture/worker/althar-worker.js',
      },
      signingKey,
      now: NOW,
      assemble: async (_: unknown, folder: string) => {
        fixtureFiles(folder)
      },
      assembleWorker: async (_: unknown, folder: string) => {
        fixtureFiles(folder)
        rmSync(join(folder, 'dist/althar-host.js'))
        writeFileSync(join(folder, 'dist/althar-worker.js'), 'worker commands', { mode: 0o600 })
        writeFileSync(join(folder, 'althar-worker'), 'worker', { mode: 0o700 })
      },
      execute: async (_: string, args: ReadonlyArray<string>) => {
        ran.push(args)
        return args.includes('version') ? says : JSON.stringify(releaseInfo())
      },
    })
    const said = JSON.stringify({ protocol: 1, step: 'version', state: 'done', version: releaseInfo().version, arch: releaseInfo().arch })
    const result = await packageRelease(options('out'), dependencies(said))
    if (result.worker === undefined) throw new Error('No worker release was signed')
    expect(result.worker.archive).toMatch(new RegExp(`althar-worker-${releaseInfo().version}-linux-${releaseInfo().arch}\\.tar\\.gz$`))
    const worker = authenticateRelease(readFileSync(result.worker.manifest), [publicKey], releaseInfo().arch)
    expect(worker.manifest).toMatchObject({ product: 'worker', sequence: 4, version: releaseInfo().version })
    expect(worker.manifest.archive.url).toBe(`https://releases.example/host-v0.1.0/${result.worker.archive.split('/').at(-1)}`)
    await inspectArchive(result.worker.archive, worker.manifest)
    // The home's says nothing of what it is, as before, so verifiers from before take it as theirs.
    expect(authenticateRelease(readFileSync(result.manifest), [publicKey], releaseInfo().arch).manifest.product).toBeUndefined()
    expect(ran.some((args) => args.at(-1) === 'version' && args[0]?.endsWith('dist/althar-worker.js'))).toBe(true)
    // A worker release that says another version than it is signed for isn't signed.
    await expect(
      packageRelease(
        options('other'),
        dependencies(JSON.stringify({ step: 'version', state: 'done', version: '0.0.1', arch: releaseInfo().arch })),
      ),
    ).rejects.toThrow('does not say the version')
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
