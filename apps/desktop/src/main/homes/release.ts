import { createHash, createPublicKey, verify } from 'node:crypto'

/*
 * The althar-host release a new home is set up from: found where the host's own updater finds it (this repository's
 * GitHub releases, tagged host-v…), and authenticated here, before anything of it reaches the server, against a release
 * key the desktop pins. As the host's own verifier does (apps/host/src/updates/release.ts): no field of the manifest is
 * used until its exact bytes check out under a pinned Ed25519 key, for the server's platform, and fresh.
 */

/**
 * The public halves of the keys host releases are signed with (Ed25519, SPKI PEM). The first is the key host-v0.1.0 was
 * signed with (keyId 22735d0dc71860e22ab718b88997dcb829d6a46dd5d1a7b219b0f36b99464700, the SHA-256 of its DER).
 */
export const HOST_RELEASE_KEYS: ReadonlyArray<string> = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA4IfWro8ZWZWyiGUIqFKQ425o4UKX6QdGIy30aKM7fKY=
-----END PUBLIC KEY-----
`,
]
const REPOSITORY = 'AltharIDE/althar'
const MAX_MANIFEST_BYTES = 65_536
const MAX_ARCHIVE_BYTES = 1_073_741_824
const MAX_UNPACKED_BYTES = 4_294_967_296

export interface HostRelease {
  /** The signed envelope, as published: what the server keeps beside the release and checks again. */
  readonly envelope: Uint8Array
  /** The pinned key it checked out under, as PEM. */
  readonly key: string
  readonly version: string
  /** The API version it serves, and the fingerprint of how it stores its data (apps/host/src/updates/info.ts). */
  readonly apiVersion: number
  readonly storage: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly unpackedBytes: number
}

export class ReleaseProblem extends Error {
  constructor(readonly code: 'NoRelease' | 'ReleaseRejected') {
    super(code === 'NoRelease' ? 'No althar-host release is published to set a home up from.' : 'The althar-host release failed its check.')
  }
}
const rejected = () => new ReleaseProblem('ReleaseRejected')

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const keyId = (pem: string) => digest(createPublicKey(pem).export({ type: 'spki', format: 'der' }))
const decode = (value: unknown, maximum: number) => {
  if (typeof value !== 'string') throw rejected()
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length > maximum || bytes.toString('base64url') !== value) throw rejected()
  return bytes
}
const instant = (value: unknown) => {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(at)) throw rejected()
  return at
}
const natural = (value: unknown, maximum: number) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw rejected()
  return value
}
const json = (bytes: Uint8Array): Record<string, unknown> => {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw rejected()
  return value as Record<string, unknown>
}

/** The release in these bytes, where they authenticate under one of the keys, for this server's architecture, now. */
export const authenticateRelease = (bytes: Uint8Array, keys: ReadonlyArray<string>, arch: string, now = Date.now()): HostRelease => {
  try {
    if (bytes.length > MAX_MANIFEST_BYTES || keys.length === 0) throw rejected()
    const envelope = json(bytes)
    if (envelope.format !== 1 || typeof envelope.keyId !== 'string') throw rejected()
    const key = keys.find((pem) => keyId(pem) === envelope.keyId)
    if (key === undefined) throw rejected()
    const payload = decode(envelope.payload, MAX_MANIFEST_BYTES)
    const signature = decode(envelope.signature, 64)
    const publicKey = createPublicKey(key)
    if (publicKey.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !verify(null, payload, publicKey, signature))
      throw rejected()
    const manifest = json(payload)
    const archive = manifest.archive as Record<string, unknown> | undefined
    const published = instant(manifest.publishedAt)
    const expires = instant(manifest.expiresAt)
    if (
      manifest.format !== 1 ||
      manifest.platform !== 'linux' ||
      manifest.arch !== arch ||
      typeof manifest.version !== 'string' ||
      !/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(manifest.version) ||
      typeof archive !== 'object' ||
      archive === null ||
      typeof archive.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(archive.sha256) ||
      typeof archive.url !== 'string' ||
      typeof manifest.apiVersion !== 'number' ||
      !Number.isSafeInteger(manifest.apiVersion) ||
      typeof manifest.storage !== 'string' ||
      !/^[a-f0-9]{64}$/.test(manifest.storage) ||
      expires <= published ||
      published > now + 300_000 ||
      expires <= now
    )
      throw rejected()
    const url = new URL(archive.url)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') throw rejected()
    return {
      envelope: bytes,
      key,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      storage: manifest.storage,
      url: url.href,
      sha256: archive.sha256,
      bytes: natural(archive.bytes, MAX_ARCHIVE_BYTES),
      unpackedBytes: natural(manifest.unpackedBytes, MAX_UNPACKED_BYTES),
    }
  } catch (error) {
    throw error instanceof ReleaseProblem ? error : rejected()
  }
}

export type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>
const read = async (fetcher: Fetch, url: string, limit: number, signal: AbortSignal) => {
  const response = await fetcher(url, { signal, headers: { accept: 'application/json', 'user-agent': 'Althar desktop' } })
  if (!response.ok) throw new ReleaseProblem(response.status === 404 ? 'NoRelease' : 'ReleaseRejected')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > limit) throw rejected()
  return bytes
}

export interface ReleaseSource {
  readonly keys: ReadonlyArray<string>
  /** A manifest's address of its own, for trying a release of your own; else the newest host-v… release on GitHub. */
  readonly manifest?: string
  readonly fetch?: Fetch
  readonly now?: () => number
}

/** The newest host release for this architecture, authenticated; NoRelease where none is published or pinned. */
export const findRelease = async (arch: string, source: ReleaseSource, signal: AbortSignal): Promise<HostRelease> => {
  if (source.keys.length === 0) throw new ReleaseProblem('NoRelease')
  const fetcher = source.fetch ?? fetch
  const manifestAt = async () => {
    if (source.manifest !== undefined) return source.manifest
    const listed: unknown = JSON.parse(
      new TextDecoder().decode(await read(fetcher, `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, 4_194_304, signal)),
    )
    const name = `althar-host-linux-${arch}.json`
    for (const release of Array.isArray(listed) ? listed : []) {
      if (typeof release !== 'object' || release === null) continue
      const { draft, prerelease, tag_name: tag, assets } = release as Record<string, unknown>
      if (draft === true || prerelease === true || typeof tag !== 'string' || !/^host-v\d+\.\d+\.\d+$/.test(tag)) continue
      const asset = (Array.isArray(assets) ? assets : []).find(
        (one: unknown) => typeof one === 'object' && one !== null && (one as Record<string, unknown>).name === name,
      ) as Record<string, unknown> | undefined
      if (typeof asset?.browser_download_url === 'string') return asset.browser_download_url
    }
    throw new ReleaseProblem('NoRelease')
  }
  const bytes = await read(fetcher, await manifestAt(), MAX_MANIFEST_BYTES, signal)
  return authenticateRelease(bytes, source.keys, arch, source.now?.() ?? Date.now())
}

const versionOf = (tag: string) => /^host-v(\d{1,9}\.\d{1,9}\.\d{1,9})$/.exec(tag)?.[1]
const later = (left: string, right: string) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  return false
}

/**
 * Whether the newest host release can add a worker, asked before adding one: only a release that publishes the worker's
 * bootstrap (`althar-worker.sh`) and its public key beside its signed manifests carries the worker (host-v0.1.0 came
 * before it), and its manifest must check out under a pinned key. `base`: where that release's files are, for the code's
 * line to take them from (the repository's latest release is the desktop's, not the host's). A release of your own
 * (`manifest`) is taken as able, unread, its files beside its manifest. Only a release that came before workers is
 * `none`; where it can't be found out (the network, a manifest that fails its check), it throws, and adding goes on.
 */
export type WorkerRelease =
  | { readonly kind: 'ready'; readonly version: string; readonly base: string }
  | { readonly kind: 'none'; readonly newest: string | null; readonly why: string }

export const workerRelease = async (source: ReleaseSource, signal: AbortSignal): Promise<WorkerRelease> => {
  const fetcher = source.fetch ?? fetch
  const now = source.now?.() ?? Date.now()
  if (source.manifest !== undefined)
    return { kind: 'ready', version: 'own', base: source.manifest.slice(0, source.manifest.lastIndexOf('/')) }
  const listed: unknown = JSON.parse(
    new TextDecoder().decode(await read(fetcher, `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, 4_194_304, signal)),
  )
  let newest: { version: string; tag: string; assets: Map<string, string> } | undefined
  for (const release of Array.isArray(listed) ? listed : []) {
    if (typeof release !== 'object' || release === null) continue
    const { draft, prerelease, tag_name: tag, assets } = release as Record<string, unknown>
    const version = draft === true || prerelease === true || typeof tag !== 'string' ? undefined : versionOf(tag)
    if (version === undefined || (newest !== undefined && !later(version, newest.version))) continue
    const named = new Map<string, string>()
    for (const one of Array.isArray(assets) ? assets : []) {
      const { name, browser_download_url: url } = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
      if (typeof name === 'string' && typeof url === 'string') named.set(name, url)
    }
    newest = { version, tag: tag as string, assets: named }
  }
  if (newest === undefined) return { kind: 'none', newest: null, why: 'No host release is published.' }
  const missing = ['althar-worker.sh', 'althar-host-release.pub', 'althar-host-linux-x64.json'].filter((name) => !newest.assets.has(name))
  if (missing.length > 0)
    return { kind: 'none', newest: newest.version, why: `${newest.tag} publishes no ${missing.join(', ')}: it came before workers.` }
  const signed = authenticateRelease(
    await read(fetcher, newest.assets.get('althar-host-linux-x64.json')!, MAX_MANIFEST_BYTES, signal),
    source.keys,
    'x64',
    now,
  )
  if (signed.version !== newest.version) throw rejected()
  return { kind: 'ready', version: newest.version, base: `https://github.com/${REPOSITORY}/releases/download/${newest.tag}` }
}

/**
 * The newest host release published, by its version (null where there's none), for the window to offer an older home's
 * update by: whether one would help, before it's run. Nothing of it is trusted beyond that, so it needs no pinned key:
 * the home's own updater authenticates what it takes. Where a release of your own is tried (`manifest`), its version,
 * read from it unchecked.
 */
export const newestHostVersion = async (source: ReleaseSource, signal: AbortSignal): Promise<string | null> => {
  const fetcher = source.fetch ?? fetch
  if (source.manifest !== undefined) {
    const envelope = json(await read(fetcher, source.manifest, MAX_MANIFEST_BYTES, signal))
    const version = json(decode(envelope.payload, MAX_MANIFEST_BYTES)).version
    if (typeof version !== 'string' || !/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(version)) throw rejected()
    return version
  }
  const listed: unknown = JSON.parse(
    new TextDecoder().decode(await read(fetcher, `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, 4_194_304, signal)),
  )
  let newest: string | null = null
  for (const release of Array.isArray(listed) ? listed : []) {
    if (typeof release !== 'object' || release === null) continue
    const { draft, prerelease, tag_name: tag } = release as Record<string, unknown>
    const version = draft === true || prerelease === true || typeof tag !== 'string' ? undefined : versionOf(tag)
    if (version !== undefined && (newest === null || later(version, newest))) newest = version
  }
  return newest
}
