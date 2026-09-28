import { assert, describe, it } from '@effect/vitest'

import { classify, resetTime } from '../src/failures'

const now = new Date('2026-09-28T20:00:00.000Z')

describe('classify', () => {
  it.each([
    ['Claude AI usage limit reached|1759075200', 'usage_limit'],
    ["You've hit your usage limit. Try again in 2 hours 13 minutes.", 'usage_limit'],
    ['429 Too Many Requests', 'usage_limit'],
    ['Rate limit exceeded', 'usage_limit'],
    ['Authentication required', 'auth_required'],
    ['Please log in to continue', 'auth_required'],
    ['Request timed out', 'transient'],
    ['upstream returned 503', 'transient'],
    ['Something odd happened', 'unknown'],
  ] as const)('%s is %s', (message, failure) => {
    assert.strictEqual(classify(new Error(message), now).failure, failure)
  })

  it('reads JSON-RPC error codes', () => {
    assert.strictEqual(classify({ code: -32000, message: 'nope' }, now).failure, 'auth_required')
    assert.strictEqual(classify({ code: -32602, message: 'bad params' }, now).failure, 'invalid_request')
    assert.strictEqual(classify({ code: -32601, message: 'no such method' }, now).failure, 'invalid_request')
  })

  it('looks in the error data too', () => {
    assert.strictEqual(classify({ code: -32603, message: 'Internal error', data: 'usage limit reached' }, now).failure, 'usage_limit')
    assert.strictEqual(
      classify({ code: -32603, message: 'Internal error', data: { reason: 'quota exhausted' } }, now).failure,
      'usage_limit',
    )
  })

  it('classifies anything thrown', () => {
    assert.deepStrictEqual(classify('connection reset: ECONNRESET', now), { failure: 'transient', message: 'connection reset: ECONNRESET' })
    assert.strictEqual(classify(42, now).failure, 'unknown')
  })
})

describe('resetTime', () => {
  it("reads Claude Code's epoch seconds", () => {
    assert.strictEqual(resetTime('Claude AI usage limit reached|1759075200', now), '2025-09-28T16:00:00.000Z')
  })

  it('reads an ISO time', () => {
    assert.strictEqual(resetTime('limit resets at 2026-09-28T23:30:00+01:00', now), '2026-09-28T22:30:00.000Z')
  })

  it('reads a relative time from now', () => {
    assert.strictEqual(resetTime('Try again in 2 hours 13 minutes', now), '2026-09-28T22:13:00.000Z')
    assert.strictEqual(resetTime('resets in 1 day', now), '2026-09-29T20:00:00.000Z')
    assert.strictEqual(resetTime('try again in 45 min', now), '2026-09-28T20:45:00.000Z')
  })

  it('says nothing when the error does not say', () => {
    assert.isUndefined(resetTime('usage limit reached', now))
    assert.isUndefined(classify(new Error('usage limit reached'), now).resetsAt)
  })
})
