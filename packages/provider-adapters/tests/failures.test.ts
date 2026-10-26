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

  it('reads a long run of digits with no unit after it at once, and says nothing of it', () => {
    assert.isUndefined(resetTime(`try again in ${'9'.repeat(100_000)}x`, now))
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

/*
 * Each agent's own words when a plan runs out, as its code or a person's
 * report has them (docs/plans/plan-usage.md, "Limits when they hit"). `now`
 * is 20:00 UTC on Monday 28 September 2026: 22:00 in Budapest, 13:00 in
 * California.
 */
describe('each agent’s limit, in its own words', () => {
  /** A time on this computer's own clock, the next to come. */
  const local = (hour: number, minute: number, day?: { y: number; mo: number; d: number }) => {
    const at = day === undefined ? new Date(now) : new Date(day.y, day.mo, day.d)
    at.setHours(hour, minute, 0, 0)
    if (day === undefined && at <= now) at.setDate(at.getDate() + 1)
    return at.toISOString()
  }

  it.each([
    // Claude Code 2.1.305
    ["You've hit your session limit · resets 3pm (Europe/Budapest)", 'usage_limit', '2026-09-29T13:00:00.000Z'],
    ["You've hit your limit · resets 3:30pm (Europe/Budapest)", 'usage_limit', '2026-09-29T13:30:00.000Z'],
    ["You've hit your weekly limit · resets Oct 24, 3pm (Europe/Budapest)", 'usage_limit', '2026-10-24T13:00:00.000Z'],
    ["You've hit your Opus limit · resets 11pm (Europe/Budapest)", 'usage_limit', '2026-09-28T21:00:00.000Z'],
    ["You're out of usage credits", 'usage_limit', undefined],
    ["You've hit your monthly spend limit.", 'usage_limit', undefined],
    // Gemini's, which Qwen Code and Antigravity share
    ['You have exhausted your capacity on this model. Your quota will reset after 19h14m47s.', 'usage_limit', '2026-09-29T15:14:47.000Z'],
    [
      'Usage limit reached for gemini-3.8-pro.\nAccess resets at 3:05 PM PDT.\n/stats model for usage details',
      'usage_limit',
      '2026-09-28T22:05:00.000Z',
    ],
    ['[API Error: Rate limit exceeded (Status: RESOURCE_EXHAUSTED)]', 'usage_limit', undefined],
    ['Resource has been exhausted (e.g. check quota).\nSuggested retry after 68940s.', 'usage_limit', '2026-09-29T15:09:00.000Z'],
    ['Individual quota reached. Please upgrade your subscription to increase your limits.', 'usage_limit', undefined],
    // Qwen Code
    [
      'Quota exhausted: Your token-plan 1-week quota has been exhausted. The quota will reset at 07-27 09:25:00 UTC.\n\nPlease retry after the reset time, or switch to another API key / auth method.',
      'usage_limit',
      '2027-07-27T09:25:00.000Z',
    ],
    [
      'Qwen OAuth free tier has been discontinued as of 2026-04-15.\n\nTo continue using Qwen Code, try one of these alternatives',
      'auth_required',
      undefined,
    ],
    ['Rate limit exceeded. Try again later.', 'transient', undefined],
    // Copilot CLI 1.0.63
    [
      "You've hit your rate limit. Please wait for your limit to reset in 3 hours 20 minutes or switch to auto model to continue. Learn More (https://docs.github.com/copilot/concepts/rate-limits).",
      'usage_limit',
      '2026-09-28T23:20:00.000Z',
    ],
    [
      "You've reached your weekly rate limit. Please wait for your limit to reset in under a minute or switch to auto model to continue.",
      'usage_limit',
      '2026-09-28T20:01:00.000Z',
    ],
    [
      "You've hit the rate limit for this model. Please switch models or wait for your limit to reset in 7 minutes.",
      'usage_limit',
      '2026-09-28T20:07:00.000Z',
    ],
    [
      "You've run out of your included AI credits for the month. Manage budget: https://github.com/settings/copilot/features",
      'usage_limit',
      undefined,
    ],
    ["You've reached the spending limit for this session. Start a new session to continue.", 'context_full', undefined],
    // Grok Build 1.0.62
    [
      'You’ve reached your free Grok Build usage limit for now. Get SuperGrok for much higher limits, or try again later: https://grok.com/supergrok?referrer=grok-build',
      'usage_limit',
      undefined,
    ],
    ['You hit your weekly limit.', 'usage_limit', undefined],
    ['You’ve hit the credit limit for your plan.', 'usage_limit', undefined],
    ['You’ve hit your spending cap.', 'usage_limit', undefined],
    ['API error (status 402): spending-limit', 'usage_limit', undefined],
    ['You’ve hit the rate limit for your plan. Upgrade your account or try again later.', 'transient', undefined],
    // Kimi Code, from its error reference
    [
      "Error code: 403 - {'error': {'message': \"You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.\"}}",
      'usage_limit',
      undefined,
    ],
    ["You've reached your weekly (7-day) usage limit.", 'usage_limit', undefined],
    ["You've reached your concurrent request limit.", 'transient', undefined],
    ["We're receiving too many requests at the moment.", 'transient', undefined],
    ["We're unable to verify your membership benefits at this time.", 'usage_limit', undefined],
    // OpenCode, 1 and 2
    [
      'Claude Max usage limit reached. It will reset in 3 hours 20 minutes. To continue using this model now, enable usage from your available balance',
      'usage_limit',
      '2026-09-28T23:20:00.000Z',
    ],
    ['Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.', 'usage_limit', undefined],
    // Mistral Vibe
    ['LLM backend error [mistral]\n  status: 402 Payment Required', 'usage_limit', undefined],
    // Codex
    ['Your workspace is out of credits. Ask your admin to add more.', 'usage_limit', undefined],
    ['You hit your spend cap set in your workspace.', 'usage_limit', undefined],
    // Not a plan's: a full context, memory, and an ordinary error.
    ["You've reached your context limit.", 'context_full', undefined],
    ['The process has run out of memory', 'unknown', undefined],
  ] as const)('%s is %s', (message, failure, resetsAt) => {
    const classified = classify(new Error(message), now)
    assert.strictEqual(classified.failure, failure)
    assert.strictEqual(classified.resetsAt, resetsAt)
  })

  it('reads Codex’s and Copilot’s times on this computer’s clock, today or on the day they name', () => {
    const codex =
      'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 3:05 PM.'
    assert.deepStrictEqual(classify(new Error(codex), now), { failure: 'usage_limit', message: codex, resetsAt: local(15, 5) })
    assert.strictEqual(
      resetTime('You’ve hit your usage limit. Try again at Oct 23rd, 2026 3:05 PM.', now),
      local(15, 5, { y: 2026, mo: 9, d: 23 }),
    )
    assert.strictEqual(
      resetTime(
        "You've hit your rate limit. Please wait for your limit to reset on October 23, 2026 at 3:05 PM or switch to auto model to continue.",
        now,
      ),
      local(15, 5, { y: 2026, mo: 9, d: 23 }),
    )
    assert.strictEqual(resetTime("Your plan's baseline quota will refresh on July 15, 2027.", now), local(0, 0, { y: 2027, mo: 6, d: 15 }))
  })

  it('reads the codes Junie, Mistral Vibe and OpenCode give over ACP', () => {
    const junie = {
      code: -32010,
      message: 'Insufficient account balance. All tokens in your account have been spent.',
      data: { reason: 'insufficient_account_balance' },
    }
    assert.deepStrictEqual(classify(junie, now), { failure: 'usage_limit', message: junie.message })
    const vibe = {
      code: -31001,
      message: 'Rate limit exceeded for mistral (model: mistral-vibe-cli-latest).',
      data: { provider: 'mistral', model: 'mistral-vibe-cli-latest' },
    }
    assert.strictEqual(classify(vibe, now).failure, 'usage_limit')
    const go = {
      code: -32603,
      message: 'Internal error: Subscription quota exceeded.',
      data: { service: 'session', errorName: 'provider.quota' },
    }
    assert.strictEqual(classify(go, now).failure, 'usage_limit')
    const free = {
      code: -32603,
      message: 'Internal error: Rate limit exceeded. Please try again later.',
      data: { service: 'session', errorName: 'provider.free-limit' },
    }
    assert.strictEqual(classify(free, now).failure, 'usage_limit')
    const rate = {
      code: -32603,
      message: 'Internal error: Too Many Requests',
      data: { service: 'session', errorName: 'provider.rate-limit' },
    }
    assert.strictEqual(classify(rate, now).failure, 'transient')
    const kimi = {
      code: -32603,
      message: 'Internal error',
      data: { error: "Error code: 403 - {'error': {'message': \"You've reached your monthly usage limit for this billing cycle.\"}}" },
    }
    assert.strictEqual(classify(kimi, now).failure, 'usage_limit')
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
