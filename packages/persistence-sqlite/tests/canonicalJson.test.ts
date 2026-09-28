import { assert, describe, it } from '@effect/vitest'

import { canonicalJson, sha256Hex } from '../src/canonicalJson'

describe('canonicalJson', () => {
  it('sorts object keys at every depth, and keeps array order', () => {
    assert.strictEqual(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}')
    assert.strictEqual(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
  })

  it('writes null for what JSON cannot hold', () => {
    assert.strictEqual(canonicalJson(undefined), 'null')
  })

  it('hashes to 64 hex digits', () => {
    assert.strictEqual(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
