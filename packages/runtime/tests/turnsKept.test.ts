import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * Turns kept waiting for a place on their threads, as Althar finds them
 * when it starts (Busy.ts), where busy.test.ts doesn't go: one on a thread
 * no agent was ever on, and one that carries what the person said.
 */

const waitsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ since: string | null }>`SELECT waits_for_place AS since FROM threads WHERE id = ${threadId}`
    return row?.since ?? null
  })

/**
 * A turn on the thread waits for a place, as Althar left it when it stopped: written with Althar closed, as a look at what
 * waits reads it as Althar starts, and one already running looks again only once woken.
 */
const keptWaiting = (file: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE threads SET waits_for_place = ${new Date().toISOString()} WHERE id = ${threadId}`
  }).pipe(Effect.provide(Database.layer({ filename: file })))

/** Looked at often, on a machine with room. */
const often = (file = ':memory:') => runtime(file, {}, { busy: { every: Duration.millis(100) } })

describe('a turn kept waiting for a place', () => {
  it.live('waits no more on a thread no agent was ever on, once Althar starts, and starts nothing', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-kept-')), 'althar.sqlite')
      // As Althar stopped, a turn on a thread no agent was ever on waited for a place.
      const threadId = yield* Effect.gen(function* () {
        const { task: created } = yield* task('Never started')
        return created.threadId
      }).pipe(Effect.provide(runtime(file)))
      yield* keptWaiting(file, threadId)
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        yield* until(
          Effect.map(waitsOn(threadId), (since) => (since === null ? [since] : [])),
          (rows) => rows.length === 1,
        )
        assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      }).pipe(Effect.provide(often(file)))
    }),
  )

  it.live('starts the agent last on the thread for what the person said, at once', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-kept-')), 'althar.sqlite')
      const body = 'Carry on with the docs.'
      // As Althar stopped, what the person said to a thread whose agent was stopped waited for a place.
      const threadId = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task('Said meanwhile')
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
        yield* sessions.stop(created.threadId)
        yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: created.threadId, body })
        return created.threadId
      }).pipe(Effect.provide(runtime(file)))
      yield* keptWaiting(file, threadId)
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const [delivered] = yield* until(
          Effect.map(turns(threadId), (rows) => rows.filter((row) => row.prompt?.endsWith(body) === true)),
          (rows) => rows.length === 1,
        )
        assert.strictEqual(delivered?.inputs, 1)
        assert.strictEqual(Option.getOrUndefined(yield* sessions.running(threadId))?.agentId, 'codex')
        assert.isNull(yield* waitsOn(threadId))
      }).pipe(Effect.provide(often(file)))
    }),
  )
})
