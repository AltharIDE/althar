import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { Schema } from 'effect'

import { HostError } from '../errors'
import { privateDirectory } from '../privateFiles'
import { extractRelease } from './archive'
import { executeUpdate, runRelease, type UpdateExecutor } from './execute'
import { ReleaseInfo } from './info'
import { downloadRelease, getUpdateBytes, type UpdateFetch } from './network'
import { authenticateRelease, compareVersions, MAX_MANIFEST_BYTES, verifyRelease, type VerifiedRelease } from './release'
import { loadInstallation, newUpdateId, readRelease, saveState, storeSigned, syncFolder, type Installation } from './store'

const GitHubRelease = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    prerelease: Schema.Boolean,
    assets: Schema.Array(Schema.Struct({ name: Schema.String, browser_download_url: Schema.String })),
  }),
)
const unavailable = () =>
  new HostError({
    code: 'UpdateUnavailable',
    message: 'No authenticated host release is available from the configured update source. The installed host is unchanged.',
  })
export interface StageDependencies {
  readonly fetch?: UpdateFetch
  readonly execute?: UpdateExecutor
  readonly now?: () => number
}

export const findManifest = async (installation: Installation, fetcher: UpdateFetch = fetch, signal?: AbortSignal) => {
  const feed = installation.config.feed
  if (feed.kind === 'manifest') return getUpdateBytes(feed.url, MAX_MANIFEST_BYTES, fetcher, signal)
  const assetName = `althar-host-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.json`
  for (let page = 1; page <= 10; page++) {
    const bytes = await getUpdateBytes(
      `https://api.github.com/repos/${feed.repository}/releases?per_page=100&page=${page}`,
      2_097_152,
      fetcher,
      signal,
    )
    const releases = Schema.decodeUnknownSync(GitHubRelease)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    const release = releases.find(
      (item) =>
        !item.draft &&
        !item.prerelease &&
        /^host-v\d+\.\d+\.\d+$/.test(item.tag_name) &&
        item.assets.some((asset) => asset.name === assetName),
    )
    const asset = release?.assets.find((item) => item.name === assetName)
    if (asset !== undefined) return getUpdateBytes(asset.browser_download_url, MAX_MANIFEST_BYTES, fetcher, signal)
    if (releases.length < 100) break
  }
  throw unavailable()
}
export const checkCandidate = async (
  folder: string,
  expected: typeof ReleaseInfo.Type,
  execute: UpdateExecutor = executeUpdate,
  signal?: AbortSignal,
) => {
  for (const name of ['dist/althar-host.js', 'node/bin/node', 'node/LICENSE', 'package.json']) {
    const stat = await fs.lstat(join(folder, name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw unavailable()
  }
  const actual = Schema.decodeUnknownSync(ReleaseInfo)(
    JSON.parse(await runRelease({ folder }, ['verify-release', '--json'], execute, signal)),
  )
  if (
    actual.version !== expected.version ||
    actual.apiVersion !== expected.apiVersion ||
    actual.storage !== expected.storage ||
    actual.arch !== expected.arch
  )
    throw new HostError({
      code: 'ReleaseRejected',
      message: 'The release executable does not match its signed API, data format, version or target metadata.',
    })
}
const expectedInfo = (release: VerifiedRelease): typeof ReleaseInfo.Type => ({
  version: release.manifest.version,
  updaterProtocol: 1,
  apiVersion: release.manifest.apiVersion,
  storage: release.manifest.storage,
  platform: 'linux',
  arch: release.manifest.arch,
})

/** Checking and staging never stop the runtime or change its active program. Caller holds the installation's OS lock. */
export const stageUpdate = async (root: string, dependencies: StageDependencies = {}, signal?: AbortSignal) => {
  const installation = await loadInstallation(root)
  if (installation.state.transaction !== undefined && installation.state.transaction.phase !== 'recovery-required')
    throw new HostError({
      code: 'UpdateBusy',
      message: 'An update or recovery transaction owns this installation. Downloading will resume after it is resolved.',
    })
  const current = await readRelease(installation, installation.state.current)
  const bytes = await findManifest(installation, dependencies.fetch, signal)
  const authenticated = authenticateRelease(bytes, installation.config.keys, current.info.arch)
  if (authenticated.id === installation.state.current) return { state: 'current' as const, version: current.info.version }
  const seen = installation.state.seen === undefined ? current : await readRelease(installation, installation.state.seen)
  const repeated = authenticated.id === installation.state.seen
  const floorVersion = compareVersions(seen.info.version, current.info.version) > 0 ? seen.info.version : current.info.version
  const verified = verifyRelease(bytes, {
    keys: installation.config.keys,
    arch: current.info.arch,
    now: dependencies.now?.() ?? Date.now(),
    minimumSequence: repeated ? installation.state.sequence - 1 : installation.state.sequence,
    installedVersion: repeated ? current.info.version : floorVersion,
  })
  if (repeated && installation.state.staged === verified.id) return { state: 'staged' as const, version: verified.manifest.version }
  const scratch = join(root, `.staging-${newUpdateId()}`)
  await privateDirectory(scratch, true)
  try {
    const archive = join(scratch, 'release.tar.gz')
    await downloadRelease(verified.manifest.archive, archive, dependencies.fetch, signal)
    const folder = join(scratch, 'release')
    await extractRelease(archive, folder, verified.manifest, signal)
    await checkCandidate(folder, expectedInfo(verified), dependencies.execute, signal)
    // Orphaned, unreferenced staging from a crash may be replaced; never remove a journalled release.
    const target = join(root, 'releases', verified.id)
    const referenced = new Set([
      installation.state.current,
      installation.state.active,
      installation.state.staged,
      installation.state.seen,
      installation.state.transaction?.from,
      installation.state.transaction?.to,
      installation.config.bootstrap,
    ])
    try {
      await fs.lstat(target)
      if (referenced.has(verified.id)) throw unavailable()
      await fs.rm(target, { recursive: true, force: true })
      await fs.rm(join(root, 'records', `${verified.id}.json`), { force: true })
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    await fs.rename(folder, target)
    await syncFolder(join(root, 'releases'))
    await storeSigned(root, verified)
    await saveState(root, { ...installation.state, staged: verified.id, seen: verified.id, sequence: verified.manifest.sequence })
    return { state: 'staged' as const, version: verified.manifest.version }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}
