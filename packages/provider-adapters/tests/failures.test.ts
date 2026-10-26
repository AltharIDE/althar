import { assert, describe, it } from '@effect/vitest'

import { classify, resetTime, structuredFailure } from '../src/failures'
import { recorded } from '../src/testing/recorded'

const now = new Date('2026-09-28T20:00:00.000Z')

describe('classify', () => {
  it.each([
    ['Claude AI usage limit reached|1759075200', 'usage_limit'],
    ["You've hit your usage limit. Try again in 2 hours 13 minutes.", 'usage_limit'],
    ['Quota exceeded for this plan', 'usage_limit'],
    ['429 Too Many Requests', 'transient'],
    ['Rate limit exceeded', 'transient'],
    ['prompt is too long: 210000 tokens > 200000 maximum', 'context_full'],
    ["This model's maximum context length is 128000 tokens", 'context_full'],
    ['Authentication required', 'auth_required'],
    ['Please log in to continue', 'auth_required'],
    ['401 Unauthorized', 'auth_required'],
    ['The author of this commit logged in yesterday', 'unknown'],
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

describe('structuredFailure', () => {
  const meta = (failure: Record<string, unknown>) => ({
    jetbrains: { air: { version: 1, sessionFailure: { id: 'x', revision: 1, ...failure } } },
  })

  it.each([
    [{ category: 'limit', actions: [] }, 'usage_limit'],
    [{ category: 'limit', actions: ['retry'] }, 'transient'],
    [{ category: 'limit', actions: ['new_session'] }, 'context_full'],
    [{ category: 'access', actions: ['login'] }, 'auth_required'],
    [{ category: 'request', actions: [] }, 'invalid_request'],
    [{ category: 'service', actions: ['retry'] }, 'transient'],
    [{ category: 'connection', actions: ['retry'] }, 'transient'],
    [{ category: 'internal' }, 'unknown'],
  ] as const)('%j is %s', (failure, kind) => {
    assert.strictEqual(structuredFailure(meta({ severity: 'error', title: 'Failed', ...failure }), now)?.classified.failure, kind)
  })

  it('keeps the severity, the whole message, and when a quota resets', () => {
    assert.deepStrictEqual(
      structuredFailure(
        meta({ category: 'limit', severity: 'warning', title: 'Out of quota.', details: 'Resets in 3 hours', reason: 'plan', actions: [] }),
        now,
      ),
      {
        severity: 'warning',
        classified: { failure: 'usage_limit', message: 'Out of quota. Resets in 3 hours plan', resetsAt: '2026-09-28T23:00:00.000Z' },
      },
    )
  })

  it('ignores anything that is not a failure report', () => {
    for (const other of [
      undefined,
      null,
      'text',
      {},
      { jetbrains: {} },
      { jetbrains: { air: {} } },
      { jetbrains: { air: { sessionFailure: 'x' } } },
    ]) {
      assert.isUndefined(structuredFailure(other, now))
    }
  })
})

describe('what agents said when their connection failed', () => {
  const ended = (response: { readonly _meta?: unknown }) => structuredFailure(response._meta, now)
  const warned = (update: { readonly _meta?: unknown }) => structuredFailure(update._meta, now)

  it.each([
    ['refused', recorded.claude.refused],
    ['offline', recorded.claude.offline],
    ['dropped', recorded.claude.dropped],
    ['a server error', recorded.claude.serverError],
    ['overloaded', recorded.claude.overloaded],
    ['rate limited', recorded.claude.rateLimited],
  ] as const)('Claude Code, %s, ends its turn with a transient failure, after warnings of the same', (_, said) => {
    assert.deepStrictEqual(
      [ended(said.ended)?.severity, ended(said.ended)?.classified.failure, ended(said.ended)?.classified.message],
      ['error', 'transient', said.title],
    )
    assert.strictEqual(said.ended.stopReason, 'end_turn')
    assert.deepStrictEqual([warned(said.retrying)?.severity, warned(said.retrying)?.classified.failure], ['warning', 'transient'])
  })

  it('Codex, offline, warns that it waits for the network, which is transient', () => {
    assert.deepStrictEqual(
      [warned(recorded.codex.waiting)?.severity, warned(recorded.codex.waiting)?.classified.failure],
      ['warning', 'transient'],
    )
  })

  it('Codex, given errors, ends its turn with a transient failure', () => {
    const failed = ended(recorded.codex.serverError.ended)
    assert.deepStrictEqual([failed?.severity, failed?.classified.failure], ['error', 'transient'])
    assert.deepStrictEqual(
      [warned(recorded.codex.serverError.retrying)?.severity, warned(recorded.codex.serverError.retrying)?.classified.failure],
      ['warning', 'transient'],
    )
  })

  it.each([
    ['refused', recorded.opencode.refused],
    ['a server error', recorded.opencode.serverError],
  ] as const)('OpenCode, %s, fails its prompt with an error that is transient', (_, error) => {
    assert.deepStrictEqual(classify(error, now), { failure: 'transient', message: error.message })
  })

  it('a generic internal error is not', () => {
    assert.strictEqual(classify({ code: -32603, message: 'Internal error' }, now).failure, 'unknown')
  })
})
