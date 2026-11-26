import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonical, signAccessList, verifyAccessList } from '../src'
import { id, NOW, northbank } from './fixtures'

const keyPair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = privateKey.export({ format: 'jwk' })
  return { privateKey: jwk.d!, publicKey: publicKey.export({ format: 'jwk' }).x! }
}

const key = { id: id('key', 1), ...keyPair() }
const keys = new Map([[key.id, key.publicKey]])
const expected = { home: northbank.home, organization: northbank.organization, keys, now: NOW }

describe('canonical', () => {
  it('sorts keys at every depth and leaves arrays in order', () => {
    expect(canonical({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: null }, u: undefined })).toBe('{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}')
  })
})

describe('signed access lists', () => {
  it('verify, whatever order the keys arrived in', () => {
    const signed = signAccessList(northbank, key)
    const reordered = JSON.parse(JSON.stringify({ list: { ...signed.list }, signature: signed.signature, keyId: signed.keyId }))
    expect(verifyAccessList(reordered, expected)).toEqual({ ok: true, list: northbank })
  })

  it('refuse a changed list, another key, or a key it doesn’t know', () => {
    const signed = signAccessList(northbank, key)
    const changed = { ...signed, list: { ...signed.list, baseAccess: 'admin' } }
    expect(verifyAccessList(changed, expected)).toEqual({ ok: false, reason: 'bad_signature' })
    const other = { id: key.id, ...keyPair() }
    expect(verifyAccessList(signAccessList(northbank, other), expected)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyAccessList({ ...signed, keyId: id('key', 2) }, expected)).toEqual({ ok: false, reason: 'unknown_key' })
    expect(verifyAccessList(signed, { ...expected, keys: new Map([[key.id, 'not-a-key']]) })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('refuse a list for another home or organization, an older one, an expired one, or a newer catalog', () => {
    const signed = signAccessList(northbank, key)
    expect(verifyAccessList(signed, { ...expected, home: id('home', 2) })).toEqual({ ok: false, reason: 'other_home' })
    expect(verifyAccessList(signed, { ...expected, organization: id('org', 2) })).toEqual({ ok: false, reason: 'other_organization' })
    expect(verifyAccessList(signed, { ...expected, revision: 7 })).toEqual({ ok: false, reason: 'older' })
    expect(verifyAccessList(signed, { ...expected, revision: 6 }).ok).toBe(true)
    expect(verifyAccessList(signed, { ...expected, now: Date.parse(northbank.expiresAt) })).toEqual({ ok: false, reason: 'expired' })
    expect(verifyAccessList(signAccessList({ ...northbank, catalog: 99 }, key), expected)).toEqual({ ok: false, reason: 'newer_catalog' })
  })

  it('refuse what isn’t a signed list', () => {
    expect(verifyAccessList({ list: northbank }, expected)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyAccessList('nonsense', expected)).toEqual({ ok: false, reason: 'malformed' })
  })
})
