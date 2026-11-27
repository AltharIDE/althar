import { createHash, createPublicKey, verify } from 'node:crypto'

import { Schema } from 'effect'

import { HostError } from '../errors'

export const MAX_MANIFEST_BYTES = 65_536
export const MAX_ARCHIVE_BYTES = 1_073_741_824
export const MAX_UNPACKED_BYTES = 4_294_967_296
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const Natural = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
export const ReleaseManifest = Schema.Struct({
  format: Schema.Literal(1),
  version: Schema.String.check(Schema.isPattern(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)),
  sequence: Natural,
  publishedAt: Schema.String,
  expiresAt: Schema.String,
  platform: Schema.Literal('linux'),
  arch: Schema.Literals(['x64', 'arm64']),
  updaterProtocol: Schema.Literal(1),
  apiVersion: Natural,
  storage: Hash,
  archive: Schema.Struct({ url: Schema.String, sha256: Hash, bytes: Natural.check(Schema.isLessThanOrEqualTo(MAX_ARCHIVE_BYTES)) }),
  unpackedBytes: Natural.check(Schema.isLessThanOrEqualTo(MAX_UNPACKED_BYTES)),
  files: Natural.check(Schema.isLessThanOrEqualTo(50_000)),
  /** What it is: a home's release, or a worker's own. A manifest from before workers had their own is a home's. */
  product: Schema.optional(Schema.Literals(['host', 'worker'])),
})
export type ReleaseManifest = typeof ReleaseManifest.Type
const Envelope = Schema.Struct({ format: Schema.Literal(1), keyId: Hash, payload: Schema.String, signature: Schema.String })
const rejected = () =>
  new HostError({
    code: 'ReleaseRejected',
    message:
      'The host release failed authentication, compatibility, freshness or rollback protection. Keep the current release and inspect the update source and trusted key.',
  })
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export const httpsURL = (value: string): URL => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') throw rejected()
  return url
}

const publicKey = (pem: string) => {
  if (Buffer.byteLength(pem) > 4096 || !pem.trim().startsWith('-----BEGIN PUBLIC KEY-----')) throw rejected()
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw rejected()
  return key
}
/** Stable across PEM whitespace and line endings; trust is pinned to the actual Ed25519 public key. */
export const releaseIdentity = (pem: string) => {
  try {
    return digest(publicKey(pem).export({ type: 'spki', format: 'der' }))
  } catch {
    throw rejected()
  }
}
const decodeBytes = (value: string, maximum: number) => {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length > maximum || bytes.toString('base64url') !== value) throw rejected()
  return bytes
}
const date = (value: string) => {
  const at = Date.parse(value)
  const normalized = value.endsWith('Z') && !value.includes('.') ? value.slice(0, -1) + '.000Z' : value
  if (!Number.isFinite(at) || new Date(at).toISOString() !== normalized) throw rejected()
  return at
}
export const compareVersions = (left: string, right: string) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}
export interface ReleasePolicy {
  readonly keys: ReadonlyArray<string>
  readonly now: number
  readonly arch: 'x64' | 'arm64'
  readonly minimumSequence: number
  readonly installedVersion: string
  /** What it must be: a home's release unless said. */
  readonly product?: 'host' | 'worker'
  /**
   * The same release may do: a worker installed from a home's release moving to the worker's own of that release, signed
   * in the same run, so with the same sequence and version.
   */
  readonly sameRelease?: boolean
}
export interface VerifiedRelease {
  readonly id: string
  readonly manifest: ReleaseManifest
  readonly envelope: Uint8Array
}

/** No payload field, URL or release code is used until its exact bytes authenticate. */
export const authenticateRelease = (bytes: Uint8Array, keys: ReadonlyArray<string>, arch: 'x64' | 'arm64'): VerifiedRelease => {
  try {
    if (bytes.length > MAX_MANIFEST_BYTES || keys.length === 0 || keys.length > 8) throw rejected()
    const envelope = Schema.decodeUnknownSync(Envelope)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    const key = keys.find((pem) => releaseIdentity(pem) === envelope.keyId)
    if (key === undefined) throw rejected()
    const payload = decodeBytes(envelope.payload, MAX_MANIFEST_BYTES)
    const signature = decodeBytes(envelope.signature, 64)
    if (signature.length !== 64 || !verify(null, payload, publicKey(key), signature)) throw rejected()
    const manifest = Schema.decodeUnknownSync(ReleaseManifest)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)))
    const published = date(manifest.publishedAt)
    const expires = date(manifest.expiresAt)
    if (expires <= published || expires - published > 366 * 86_400_000 || manifest.arch !== arch) throw rejected()
    httpsURL(manifest.archive.url)
    return { id: digest(bytes), manifest, envelope: bytes }
  } catch {
    throw rejected()
  }
}
export const verifyRelease = (bytes: Uint8Array, policy: ReleasePolicy): VerifiedRelease => {
  const release = authenticateRelease(bytes, policy.keys, policy.arch)
  if (
    date(release.manifest.publishedAt) > policy.now + 300_000 ||
    date(release.manifest.expiresAt) <= policy.now ||
    (release.manifest.product ?? 'host') !== (policy.product ?? 'host') ||
    release.manifest.sequence < policy.minimumSequence + (policy.sameRelease === true ? 0 : 1) ||
    compareVersions(release.manifest.version, policy.installedVersion) < (policy.sameRelease === true ? 0 : 1)
  )
    throw rejected()
  return release
}
