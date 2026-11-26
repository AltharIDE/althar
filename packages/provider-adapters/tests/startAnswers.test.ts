import * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { connect } from '../src/AgentConnection'
import { AgentRequestFailed } from '../src/errors'
import { classify, rawOf } from '../src/failures'
import { fakeAgent } from '../src/testing/FakeAgent'

/*
 * What an agent answered a start that failed, kept whole for the log beside
 * the words the person reads: its code and all its data, whatever the data
 * holds, through the connection to the error the runtime logs.
 */

const now = new Date('2026-11-24T20:00:00.000Z')

/** A session/new whose agent throws `thrown`: the error the connection fails with. */
const refused = (thrown: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* connect({
        transport: {
          _tag: 'InProcess',
          agent: fakeAgent({
            beforeNewSession: async () => {
              throw thrown
            },
          }),
        },
        onPermission: () => Effect.succeed({ decision: 'reject' as const }),
      })
      return yield* Effect.exit(connection.newSession({ cwd: '/tmp', mode: 'ask' }))
    }),
  )

describe('an agent’s whole answer to a start that failed', () => {
  it('is kept with its code and all its data, as JSON, cut at a few thousand characters', () => {
    assert.strictEqual(
      rawOf({ code: -32603, message: 'Internal error', data: { errorKind: 1 } }),
      '{"code":-32603,"message":"Internal error","data":{"errorKind":1}}',
    )
    assert.isUndefined(rawOf('connection reset'))
    assert.isUndefined(rawOf(new Error('no code, no data')))
    const long = rawOf({ code: -32603, message: 'Internal error', data: { stderr: 'x'.repeat(10_000) } })
    assert.isAtMost(long?.length ?? 0, 4001)
    assert.isTrue(long?.endsWith('…'))
  })

  it.live('survives the connection, on the error it fails with, structured data it has no words for included', () =>
    Effect.gen(function* () {
      // An "Internal error" whose data has no words in it, as claude-agent-acp answers a worker it lost (`errorKind`).
      const exit = yield* refused(acp.RequestError.internalError({ errorKind: 1, phase: 'sdk-initialize' }))
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isSuccess(exit)) return
      const error = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
      assert.instanceOf(error?._tag === 'Fail' ? error.error : undefined, AgentRequestFailed)
      const failed = (error as { readonly error: AgentRequestFailed }).error
      assert.strictEqual(failed.message, 'Internal error')
      assert.include(failed.raw, '"errorKind":1')
      assert.include(failed.raw, '"code":-32603')
    }),
  )

  it.live('and its words are what its data says, where it says any', () =>
    Effect.gen(function* () {
      const exit = yield* refused(
        new Error("Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'"),
      )
      if (Exit.isSuccess(exit)) throw new Error('It should have failed.')
      const error = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
      const failed = (error as { readonly error: AgentRequestFailed }).error
      assert.strictEqual(
        failed.message,
        "Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'",
      )
      assert.include(failed.raw, '"details"')
    }),
  )

  it('reads a reason in the data, as its class is read from it', () => {
    // An "Internal error" whose data names its reason: classed transient from it, and said by it.
    assert.deepStrictEqual(classify({ code: -32603, message: 'Internal error', data: { reason: 'network' } }, now), {
      failure: 'transient',
      message: 'network',
    })
  })
})
