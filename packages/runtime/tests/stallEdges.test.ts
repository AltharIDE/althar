import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'

import type { StallOptions } from '../src/Config'
import { Instance } from '../src/Instance'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, runtime, task as newTask, turns, until } from './support'

/*
 * What Althar does about a turn that stalls or runs past its budget, where
 * stalls.test.ts and coordinator.test.ts don't go: an agent quiet in a tool
 * that names no command, and Althar's own words to a lead outside a step.
 */

/** Stalls told in a moment rather than minutes; a stop is waited for long enough to see it come. */
const FAST: StallOptions = {
  every: Duration.millis(50),
  quiet: Duration.millis(400),
  quietInTool: Duration.millis(400),
  cancelGrace: Duration.seconds(2),
}

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

describe('outside a step', () => {
  it.live('names the tool an agent went quiet in by its title, where it ran no command', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task } = yield* newTask('Quiet reader')
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      yield* until(turns(task.threadId), (rows) => rows[0]?.state === 'completed')
      // It reads a file and goes quiet over it, longer than a tool's quiet is let be.
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: task.threadId,
        body: 'Look. [reads-after:0s]',
      })
      const [said] = yield* until(
        Effect.map(notices(task.threadId), (all) => all.filter((notice) => notice.about === 'stall')),
        (stalls) => stalls.length > 0,
      )
      assert.match(
        said?.title ?? '',
        /^Fake codex showed no sign of work for .+ while running Read checkout\.ts, so Althar stopped its turn/,
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { stalls: FAST }))),
  )

  it.live('holds Althar’s own words to a lead to no budget of turns either', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const instance = yield* Instance
      const { task } = yield* newTask('Told twice')
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      for (const [index, body] of ['The checks failed.', 'They failed again.'].entries()) {
        yield* until(turns(task.threadId), (rows) => rows.length === index + 1 && rows.every((turn) => turn.state === 'completed'))
        const envelope = yield* Runtime.envelope('thread.send', { body }, undefined, instance.systemId)
        yield* sessions.send({ envelope, threadId: task.threadId, body, quiet: true })
      }
      yield* until(turns(task.threadId), (rows) => rows.length === 3 && rows.every((turn) => turn.state === 'completed'))
      assert.deepStrictEqual(
        (yield* notices(task.threadId)).filter((notice) => notice.about === 'stall'),
        [],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { stalls: { ...FAST, turns: 1 } }))),
  )
})
