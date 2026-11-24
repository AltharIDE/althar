import type { UsageRead } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Duration, Effect, Exit } from 'effect'

import { SessionFailed } from '../src/errors'
import { PlanUsage } from '../src/PlanUsage'
import { Sessions } from '../src/Sessions'
import { stuckWhyOf } from '../src/words'
import { runtime, task } from './support'

/*
 * A signed-out Codex lists fewer models, and its `login status` may still say it is signed in where its token has expired: a step
 * on a model it no longer lists says its sign-in ended, whose call offers signing in again, where its usage reads as refused.
 */

const withUsage = (answer: () => UsageRead) =>
  runtime(
    ':memory:',
    {},
    { usage: { every: Duration.zero, kept: Duration.zero, readAgent: async () => answer(), readVersion: async () => '2.0.29' } },
  )

const startOn = (model: string) =>
  Effect.gen(function* () {
    const { task: created } = yield* task()
    const exit = yield* Effect.exit((yield* Sessions).start({ threadId: created.threadId, agentId: 'codex', model }))
    if (Exit.isSuccess(exit)) return assert.fail('The start should fail on a model the agent doesn’t offer.')
    const failure = exit.cause.reasons.find(Cause.isFailReason)?.error
    assert.instanceOf(failure, SessionFailed)
    return (failure as SessionFailed).summary
  })

describe('a start on a model the agent doesn’t offer', () => {
  it.live('says the sign-in ended, offering it again, where the account’s usage was refused', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      yield* usage.now(true)
      const summary = yield* startOn('gpt-6.2-sol')
      assert.strictEqual(summary, 'Its sign-in has ended. Sign it in again in Settings, then try again.')
      assert.strictEqual(stuckWhyOf(summary), 'sign_in_ended')
    }).pipe(Effect.provide(withUsage(() => ({ kind: 'failed', message: 'unexpected status 401 Unauthorized: token_expired' })))),
  )

  it.live('says the model, where the account’s usage reads', () =>
    Effect.gen(function* () {
      yield* (yield* PlanUsage).now(true)
      assert.strictEqual(yield* startOn('gpt-6.2-sol'), "The agent doesn't offer gpt-6.2-sol.")
    }).pipe(Effect.provide(withUsage(() => ({ kind: 'none' })))),
  )
})
