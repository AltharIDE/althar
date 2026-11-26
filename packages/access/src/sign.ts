import { createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto'

import { Schema } from 'effect'

import { CATALOG_VERSION } from './catalog'
import { type AccessList, AccessList as AccessListSchema } from './list'

/**
 * The cloud signs each access list with an Ed25519 key; a home verifies it with the public keys it was given at
 * enrolment, by key id, so a key can be rotated with the old one still accepted for a while. The signature covers a
 * canonical encoding of the list (keys sorted, no spaces), so the same list always signs to the same bytes.
 */

export const KeyId = Schema.String.check(Schema.isPattern(/^key_[0-9a-f]{32}$/))

export const SignedAccessList = Schema.Struct({
  keyId: KeyId,
  /** Unpadded base64url Ed25519 signature over `canonical(list)`, domain-separated. */
  signature: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)),
  list: AccessListSchema,
})
export type SignedAccessList = typeof SignedAccessList.Type

/** A JSON value with object keys sorted at every depth. Arrays keep their order. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const DOMAIN = 'althar.access-list.v1\n'

const signingInput = (list: AccessList): Buffer => Buffer.from(DOMAIN + canonical(list), 'utf8')

/** Ed25519 keys as their raw 32 bytes, unpadded base64url, the way client keys already travel. */
const publicKeyFrom = (raw: string) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })

export const signAccessList = (
  list: AccessList,
  key: { readonly id: string; readonly privateKey: string; readonly publicKey: string },
): SignedAccessList => {
  const privateKey = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: key.privateKey, x: key.publicKey }, format: 'jwk' })
  return { keyId: key.id, signature: signBytes(null, signingInput(list), privateKey).toString('base64url'), list }
}

export type ListRefusal =
  | 'malformed'
  | 'unknown_key'
  | 'bad_signature'
  | 'other_home'
  | 'other_organization'
  | 'older'
  | 'expired'
  | 'newer_catalog'

export type ListCheck = { readonly ok: true; readonly list: AccessList } | { readonly ok: false; readonly reason: ListRefusal }

export interface Expected {
  readonly home: string
  /** The organization this home serves, once it has one; a first list may set it. */
  readonly organization?: string
  /** The revision of the list the home holds now, if any. A list must be newer to replace it. */
  readonly revision?: number
  /** Trusted public keys by id. */
  readonly keys: ReadonlyMap<string, string>
  readonly now: number
}

/** What a home runs before keeping a list: the signature, then that it is for this home, newer, unexpired and readable. */
export const verifyAccessList = (input: unknown, expected: Expected): ListCheck => {
  const decoded = Schema.decodeUnknownOption(SignedAccessList)(input)
  if (decoded._tag === 'None') return { ok: false, reason: 'malformed' }
  const { keyId, signature, list } = decoded.value
  const key = expected.keys.get(keyId)
  if (key === undefined) return { ok: false, reason: 'unknown_key' }
  let valid: boolean
  try {
    valid = verifyBytes(null, signingInput(list), publicKeyFrom(key), Buffer.from(signature, 'base64url'))
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'bad_signature' }
  if (list.home !== expected.home) return { ok: false, reason: 'other_home' }
  if (expected.organization !== undefined && list.organization !== expected.organization) return { ok: false, reason: 'other_organization' }
  if (expected.revision !== undefined && list.revision <= expected.revision) return { ok: false, reason: 'older' }
  if (Date.parse(list.expiresAt) <= expected.now) return { ok: false, reason: 'expired' }
  if (list.catalog > CATALOG_VERSION) return { ok: false, reason: 'newer_catalog' }
  return { ok: true, list }
}
