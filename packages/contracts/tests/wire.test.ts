import { assert, describe, it } from '@effect/vitest'

import { decodeWire, encodeWire } from '../src/wire'

describe('portable RPC wire values', () => {
  it('preserves request ids, bytes, undefined values and tag-looking user data without collisions', () => {
    const value = [
      0,
      {
        id: 9007199254740993n,
        bytes: new Uint8Array([0, 1, 254, 255]),
        optional: undefined,
        user: { type: 'bigint', value: '123' },
        text: '\u0000bigint:456',
      },
    ]
    assert.deepStrictEqual(decodeWire(encodeWire(value)), value)
  })
  it('rejects malformed values, duplicate keys, invalid byte encodings and excessive nesting', () => {
    for (const text of [
      'null',
      '{',
      '{"version":2,"data":null}',
      '{"version":1,"data":{"type":"bigint","value":"1e100"}}',
      '{"version":1,"data":{"type":"bytes","value":"???"}}',
      '{"version":1,"data":{"type":"object","value":[["x",1],["x",2]]}}',
    ])
      assert.throws(() => decodeWire(text))
    let deep: unknown = 'leaf'
    for (let i = 0; i < 70; i += 1) deep = [deep]
    assert.throws(() => encodeWire(deep))
    let encoded: unknown = 'leaf'
    for (let i = 0; i < 70; i += 1) encoded = { type: 'array', value: [encoded] }
    assert.throws(() => decodeWire(JSON.stringify({ version: 1, data: encoded })))
    assert.throws(() => encodeWire(10n ** 128n))
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    assert.throws(() => encodeWire(cyclic))
    assert.throws(() => encodeWire(Number.NaN))
    assert.throws(() => encodeWire(() => undefined))
  })
})
