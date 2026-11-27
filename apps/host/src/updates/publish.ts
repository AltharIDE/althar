import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { c } from 'tar'

import type { HostOptions } from '../options'
import { privateDirectory, writePrivate } from '../privateFiles'
import { assembleBundle, assembleWorkerBundle, type BundleSource } from './bundle'
import { releaseInfo } from './info'
import { httpsURL, releaseIdentity, verifyRelease, type ReleaseManifest } from './release'
import { newUpdateId, updateError } from './store'
import { syncReleaseTree } from './archive'
import { checkCandidate } from './stage'
import { executeUpdate, type UpdateExecutor } from './execute'

const inventory = async (folder: string): Promise<{ files: number; bytes: number }> => {
  let files = 0
  let bytes = 0
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      const child = await inventory(path)
      files += child.files
      bytes += child.bytes
    } else if (entry.isFile()) {
      files++
      bytes += (await fs.stat(path)).size
    } else throw updateError('UpdateFailed', 'A release bundle contains a non-regular file or symbolic link.')
  }
  return { files, bytes }
}
export interface PublishDependencies {
  readonly assemble?: typeof assembleBundle
  readonly assembleWorker?: typeof assembleWorkerBundle
  readonly source: BundleSource
  readonly signingKey: string | undefined
  readonly now?: number
  readonly execute?: UpdateExecutor
}

/** What a worker's release must say it is, run as it will run (`althar-worker.js version`). */
const checkWorkerCandidate = async (folder: string, info: ReturnType<typeof releaseInfo>, execute: UpdateExecutor = executeUpdate) => {
  for (const name of [
    'dist/althar-worker.js',
    'althar-worker',
    'node/bin/node',
    'node/LICENSE',
    'package.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
  ]) {
    const stat = await fs.lstat(join(folder, name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw updateError('UpdateFailed', 'The worker release is missing a file it runs on.')
  }
  const said = (await execute(join(folder, 'node/bin/node'), [join(folder, 'dist/althar-worker.js'), 'version'])).trim()
  const value: unknown = JSON.parse(said.split('\n').at(-1) ?? '')
  const { version, arch } = (typeof value === 'object' && value !== null ? value : {}) as { version?: unknown; arch?: unknown }
  if (version !== info.version || arch !== info.arch)
    throw updateError('UpdateFailed', 'The worker release does not say the version or system it is signed for.')
}

/** Release CI supplies its protected signing key. The key is never written to a bundle or passed to subprocesses. */
export const packageRelease = async (options: HostOptions, dependencies: PublishDependencies) => {
  if (dependencies.signingKey === undefined || options.releaseBaseURL === undefined || options.releaseSequence === undefined)
    throw updateError(
      'UpdateNotConfigured',
      'Release packaging requires its protected Ed25519 signing key, --release-base-url and --release-sequence.',
    )
  const base = httpsURL(options.releaseBaseURL.endsWith('/') ? options.releaseBaseURL : `${options.releaseBaseURL}/`)
  const key = createPrivateKey(dependencies.signingKey)
  if (key.asymmetricKeyType !== 'ed25519') throw updateError('UpdateFailed', 'Host releases must use an Ed25519 release-signing key.')
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()
  const output = await privateDirectory(options.releaseOutput, true)
  const info = releaseInfo()
  const sequence = options.releaseSequence
  const now = dependencies.now ?? Date.now()
  /** One product's archive and its signed manifest, in `output`; each is written once, never over another. */
  const one = async (product: 'host' | 'worker', assemble: (folder: string) => Promise<void>, check: (folder: string) => Promise<void>) => {
    const scratch = join(output, `.package-${newUpdateId()}`)
    await privateDirectory(scratch, true)
    const file = `althar-${product}-${info.version}-linux-${info.arch}.tar.gz`
    const archive = join(output, file)
    const manifestPath = join(output, `althar-${product}-linux-${info.arch}.json`)
    try {
      const folder = join(scratch, 'release')
      await assemble(folder)
      await syncReleaseTree(folder)
      await check(folder)
      const counts = await inventory(folder)
      const temporary = join(scratch, 'release.tar.gz')
      await c({ file: temporary, cwd: folder, gzip: true, portable: true, noMtime: true }, await fs.readdir(folder))
      const input = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
      const hash = createHash('sha256')
      const size = (await input.stat()).size
      try {
        for await (const chunk of input.createReadStream({ autoClose: false })) {
          if (!Buffer.isBuffer(chunk)) throw updateError('UpdateFailed', 'The release archive could not be hashed as bytes.')
          hash.update(chunk)
        }
        await input.sync()
      } finally {
        await input.close()
      }
      const manifest: ReleaseManifest = {
        format: 1,
        version: info.version,
        sequence,
        publishedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 180 * 86_400_000).toISOString(),
        platform: 'linux',
        arch: info.arch,
        updaterProtocol: 1,
        apiVersion: info.apiVersion,
        storage: info.storage,
        archive: { url: new URL(file, base).href, bytes: size, sha256: hash.digest('hex') },
        files: counts.files,
        unpackedBytes: counts.bytes,
        // A home's manifest says nothing of what it is, as before workers had their own: older verifiers take it as one.
        ...(product === 'worker' ? { product } : {}),
      }
      const payload = Buffer.from(JSON.stringify(manifest))
      const envelope = Buffer.from(
        JSON.stringify({
          format: 1,
          keyId: releaseIdentity(publicKey),
          payload: payload.toString('base64url'),
          signature: sign(null, payload, key).toString('base64url'),
        }),
      )
      verifyRelease(envelope, { keys: [publicKey], arch: info.arch, minimumSequence: 0, installedVersion: '0.0.0', now, product })
      try {
        await fs.access(archive)
        throw updateError(
          'UpdateFailed',
          'This release archive already exists. Use a fresh output directory; release versions are immutable.',
        )
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      if (
        await fs.lstat(manifestPath).then(
          () => true,
          (error: unknown) => {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
            throw error
          },
        )
      )
        throw updateError('UpdateFailed', 'This output directory already holds a release manifest. Use a fresh directory.')
      await fs.link(temporary, archive)
      if (!(await writePrivate(manifestPath, envelope, false)))
        throw updateError('UpdateFailed', 'A release manifest was published concurrently. Nothing was overwritten.')
      return { archive, manifest: manifestPath }
    } finally {
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  const host = await one(
    'host',
    (folder) => (dependencies.assemble ?? assembleBundle)(dependencies.source, folder),
    (folder) => checkCandidate(folder, info, dependencies.execute),
  )
  // A worker's own release, where this one has a worker to carry: published beside the home's, signed by the same key.
  const worker =
    dependencies.source.workerEntry === undefined
      ? undefined
      : await one(
          'worker',
          (folder) => (dependencies.assembleWorker ?? assembleWorkerBundle)(dependencies.source, folder),
          (folder) => checkWorkerCandidate(folder, info, dependencies.execute),
        )
  return { ...host, ...(worker === undefined ? {} : { worker }), keyId: releaseIdentity(publicKey), ...info }
}
