import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { constants as zlib, type ZstdOptions } from 'node:zlib'

import { c } from 'tar'

import type { HostOptions } from '../options'
import { privateDirectory, writePrivate } from '../privateFiles'
import { assembleBundle, assembleWorkerBundle, type BundleSource, type WorkerPart } from './bundle'
import { releaseInfo } from './info'
import { treeDigest } from './parts'
import { httpsURL, releaseIdentity, verifyRelease, type ReleaseManifest, type ReleasePart, type ReleaseParts } from './release'
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
/**
 * Node's own zstd at level 19: Claude Code's program in 143 MB rather than gzip's 183. tar types its zstd option as zlib's
 * and hands it to Node as it is, so its level, among Node's zstd `params`, goes through a cast.
 */
const STRONG_ZSTD = { params: { [zlib.ZSTD_c_compressionLevel]: 19 } } satisfies ZstdOptions as unknown as Exclude<
  NonNullable<Parameters<typeof c>[0]['zstd']>,
  boolean
>

/** A folder's contents as a tar archive at `file`, but what `keep` leaves out: its size and SHA-256. */
const pack = async (folder: string, file: string, compression: 'gzip' | 'zstd', keep: (path: string) => boolean = () => true) => {
  const options = { file, cwd: folder, portable: true, noMtime: true, filter: (path: string) => keep(path) }
  const entries = await fs.readdir(folder)
  if (compression === 'gzip') await c({ ...options, gzip: true }, entries)
  else await c({ ...options, zstd: STRONG_ZSTD }, entries)
  const input = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
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
  return { size, sha256: hash.digest('hex') }
}

export interface PublishDependencies {
  readonly assemble?: typeof assembleBundle
  /** A worker's release, and where in it its parts are, if it has any (parts.ts). */
  readonly assembleWorker?: (source: BundleSource, folder: string) => Promise<{ readonly parts?: ReadonlyArray<WorkerPart> } | void>
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
  const one = async (
    product: 'host' | 'worker',
    assemble: (folder: string) => Promise<{ readonly parts?: ReadonlyArray<WorkerPart> } | void>,
    check: (folder: string) => Promise<void>,
  ) => {
    const scratch = join(output, `.package-${newUpdateId()}`)
    await privateDirectory(scratch, true)
    const named = (suffix: string) => `althar-${product}-${info.version}-linux-${info.arch}${suffix}`
    const file = named('.tar.gz')
    const archive = join(output, file)
    const manifestPath = join(output, `althar-${product}-linux-${info.arch}.json`)
    try {
      const folder = join(scratch, 'release')
      const parts = (await assemble(folder))?.parts ?? []
      await syncReleaseTree(folder)
      await check(folder)
      const counts = await inventory(folder)
      const temporary = join(scratch, 'release.tar.gz')
      const { size, sha256 } = await pack(folder, temporary, 'gzip')
      /** Each archive made here, where it goes in `output`. */
      const made = [{ from: temporary, to: archive }]
      // A worker's release in parts as well (parts.ts): its base, gzipped for the bootstrap's own tar, and each agent's
      // program, compressed with zstd, which only an updater that knows parts unpacks.
      let split: ReleaseParts | undefined
      if (parts.length > 0) {
        const inPart = (path: string) => parts.some((part) => path === part.path || path.startsWith(`${part.path}/`))
        const of: ReleasePart[] = []
        let partFiles = 0
        let partBytes = 0
        for (const part of parts) {
          const at = join(folder, part.path)
          const name = named(`-${part.name}.tar.zst`)
          const packed = await pack(at, join(scratch, name), 'zstd')
          const held = await inventory(at)
          partFiles += held.files
          partBytes += held.bytes
          of.push({
            name: part.name,
            path: part.path,
            tree: await treeDigest(at),
            url: new URL(name, base).href,
            sha256: packed.sha256,
            bytes: packed.size,
            files: held.files,
            unpackedBytes: held.bytes,
          })
          made.push({ from: join(scratch, name), to: join(output, name) })
        }
        const baseName = named('-base.tar.gz')
        const packed = await pack(folder, join(scratch, baseName), 'gzip', (path) => !inPart(path))
        made.push({ from: join(scratch, baseName), to: join(output, baseName) })
        split = {
          base: {
            url: new URL(baseName, base).href,
            sha256: packed.sha256,
            bytes: packed.size,
            files: counts.files - partFiles,
            unpackedBytes: counts.bytes - partBytes,
          },
          of,
        }
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
        // Before `archive`: a script that reads the payload's fields by their last mention (bootstrap/ssh.sh) reads the
        // whole archive's.
        ...(split === undefined ? {} : { parts: split }),
        archive: { url: new URL(file, base).href, bytes: size, sha256 },
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
      for (const { to } of made)
        try {
          await fs.access(to)
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
      for (const { from, to } of made) await fs.link(from, to)
      if (!(await writePrivate(manifestPath, envelope, false)))
        throw updateError('UpdateFailed', 'A release manifest was published concurrently. Nothing was overwritten.')
      return { archive, manifest: manifestPath, ...(made.length > 1 ? { parts: made.slice(1).map(({ to }) => to) } : {}) }
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
