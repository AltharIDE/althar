import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { c } from 'tar'

import type { HostOptions } from '../options'
import { privateDirectory, writePrivate } from '../privateFiles'
import { assembleBundle, type BundleSource } from './bundle'
import { releaseInfo } from './info'
import { httpsURL, releaseIdentity, verifyRelease, type ReleaseManifest } from './release'
import { newUpdateId, updateError } from './store'
import { syncReleaseTree } from './archive'
import { checkCandidate } from './stage'
import type { UpdateExecutor } from './execute'

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
  readonly source: BundleSource
  readonly signingKey: string | undefined
  readonly now?: number
  readonly execute?: UpdateExecutor
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
  const scratch = join(output, `.package-${newUpdateId()}`)
  await privateDirectory(scratch, true)
  const info = releaseInfo()
  const file = `althar-host-${info.version}-linux-${info.arch}.tar.gz`
  const archive = join(output, file)
  const manifestPath = join(output, `althar-host-linux-${info.arch}.json`)
  try {
    const folder = join(scratch, 'release')
    await (dependencies.assemble ?? assembleBundle)(dependencies.source, folder)
    await syncReleaseTree(folder)
    await checkCandidate(folder, info, dependencies.execute)
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
    const now = dependencies.now ?? Date.now()
    const manifest: ReleaseManifest = {
      format: 1,
      version: info.version,
      sequence: options.releaseSequence,
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
    verifyRelease(envelope, { keys: [publicKey], arch: info.arch, minimumSequence: 0, installedVersion: '0.0.0', now })
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
    return { archive, manifest: manifestPath, keyId: releaseIdentity(publicKey), ...info }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}
