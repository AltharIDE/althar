import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseOptions } from '../src/options'
import { packageRelease } from '../src/updates/publish'
import { authenticateRelease, digest } from '../src/updates/release'
import { extractRelease, inspectArchive } from '../src/updates/archive'
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

  it('signs a worker’s release without its agents’ own programs too, its base, beside the whole', async () => {
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
        '5',
        '--output',
        join(root, 'out'),
      ],
      {},
      root,
    )
    const program = 'node_modules/@openai/codex-test/vendor/bin/codex'
    const result = await packageRelease(options, {
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
        mkdirSync(join(folder, program, '..'), { recursive: true })
        writeFileSync(join(folder, program), 'Codex '.repeat(1000), { mode: 0o700 })
        writeFileSync(join(folder, 'node_modules/@openai/codex-test/package.json'), '{}', { mode: 0o600 })
        return { parts: [{ name: 'codex-test', path: 'node_modules/@openai/codex-test', agent: 'codex' as const }] }
      },
      execute: async (_: string, args: ReadonlyArray<string>) =>
        args.includes('version')
          ? JSON.stringify({ step: 'version', state: 'done', version: releaseInfo().version, arch: releaseInfo().arch })
          : JSON.stringify(releaseInfo()),
    })
    if (result.worker === undefined) throw new Error('No worker release was signed')
    const envelope = readFileSync(result.worker.manifest)
    const { manifest } = authenticateRelease(envelope, [publicKey], releaseInfo().arch)
    const without = manifest.base
    if (without === undefined) throw new Error('No base was signed')
    const named = `althar-worker-${releaseInfo().version}-linux-${releaseInfo().arch}`
    expect(without.url).toBe(`https://releases.example/host-v0.1.0/${named}-base.tar.gz`)
    // The base alone beside the whole: no agent's program has an archive of its own, each comes on first use.
    expect(result.worker.parts?.map((file) => file.split('/').at(-1))).toEqual([`${named}-base.tar.gz`])
    const [base] = result.worker.parts ?? []
    expect(digest(readFileSync(base ?? ''))).toBe(without.sha256)
    await inspectArchive(base ?? '', without)
    await inspectArchive(result.worker.archive, manifest)
    // The whole holds the program too, two files of 6002 bytes, for updaters from before.
    expect(manifest.files - without.files).toBe(2)
    expect(manifest.unpackedBytes - without.unpackedBytes).toBe(6002)
    const unpacked = join(root, 'base')
    await extractRelease(base ?? '', unpacked, without)
    expect(existsSync(join(unpacked, program))).toBe(false)
    expect(existsSync(join(unpacked, 'dist/althar-worker.js'))).toBe(true)
    // A script that reads the payload's fields by their last mention reads the whole archive's.
    const payload = Buffer.from(JSON.parse(envelope.toString()).payload, 'base64url').toString()
    expect(payload.indexOf('"base"')).toBeLessThan(payload.indexOf('"archive"'))
    expect(/.*"sha256":"([a-f0-9]+)"/u.exec(payload)?.[1]).toBe(manifest.archive.sha256)
  })

  it('signs no release with a link in it, nor a worker release missing what it runs on or saying nothing of itself', async () => {
    const root = temporary()
    const signingKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    let out = 0
    const options = () =>
      parseOptions(
        [
          'package-release',
          '--release-base-url',
          'https://releases.example/v/',
          '--release-sequence',
          '6',
          '--output',
          join(root, `out-${out++}`),
        ],
        {},
        root,
      )
    const source = {
      node: '/fixture/node',
      entry: '/fixture/entry',
      version: releaseInfo().version,
      worker: '/fixture/althar-worker',
      workerTools: '/fixture/tools',
      workerEntry: '/fixture/worker/althar-worker.js',
    }
    const worker = (folder: string) => {
      fixtureFiles(folder)
      writeFileSync(join(folder, 'dist/althar-worker.js'), 'worker commands', { mode: 0o600 })
      writeFileSync(join(folder, 'althar-worker'), 'worker', { mode: 0o700 })
    }
    const packaging = (assembleWorker: (folder: string) => void, says = JSON.stringify(releaseInfo())) =>
      packageRelease(options(), {
        source,
        signingKey,
        now: NOW,
        assemble: async (_: unknown, folder: string) => fixtureFiles(folder),
        assembleWorker: async (_: unknown, folder: string) => assembleWorker(folder),
        execute: async (_: string, args: ReadonlyArray<string>) => (args.includes('version') ? says : JSON.stringify(releaseInfo())),
      })
    await expect(
      packaging((folder) => {
        worker(folder)
        symlinkSync('/etc/passwd', join(folder, 'dist', 'passwd'))
      }),
    ).rejects.toMatchObject({ code: 'ReleaseRejected' })
    await expect(
      packaging((folder) => {
        worker(folder)
        // A folder where a file it runs on should be.
        rmSync(join(folder, 'node/LICENSE'))
        mkdirSync(join(folder, 'node/LICENSE'), { mode: 0o700 })
      }),
    ).rejects.toThrow('missing a file it runs on')
    await expect(packaging(worker, 'null')).rejects.toThrow('does not say the version')
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
