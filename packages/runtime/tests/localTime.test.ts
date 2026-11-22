import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'

import { Coordinator } from '../src/Coordinator'
import { localTimeWords, TIME_AGAIN_AFTER, timeAgain } from '../src/localTime'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { COMPACT, Sessions } from '../src/Sessions'
import { knownModels } from './knownModels'
import { repository, runtime, task, turns, until } from './support'

const HOURS = Duration.toMillis(TIME_AGAIN_AFTER)

describe('the local time', () => {
  it('says the date, time and zone the person reads, in the zone given', () => {
    const at = Date.parse('2025-11-19T08:05:00Z')
    assert.strictEqual(localTimeWords(at, 'Europe/Budapest'), 'Wednesday 19 November 2025, 09:05, Europe/Budapest')
    // East of the date line the day turns sooner; far west, the same instant is only just the day.
    assert.strictEqual(localTimeWords(at, 'Pacific/Kiritimati'), 'Wednesday 19 November 2025, 22:05, Pacific/Kiritimati')
    assert.strictEqual(
      localTimeWords(Date.parse('2025-11-19T12:30:00Z'), 'Pacific/Kiritimati'),
      'Thursday 20 November 2025, 02:30, Pacific/Kiritimati',
    )
    assert.strictEqual(localTimeWords(at, 'America/Los_Angeles'), 'Wednesday 19 November 2025, 00:05, America/Los_Angeles')
    assert.strictEqual(localTimeWords(at, 'UTC'), 'Wednesday 19 November 2025, 08:05, UTC')
  })

  it('is told again after a long gap, a new day or zone, or a compaction, and not every turn', () => {
    const at = Date.parse('2025-11-19T08:05:00Z')
    const told = { at, zone: 'Europe/Budapest' }
    // Never told, as since a compaction.
    assert.isTrue(timeAgain(undefined, at, at + 60_000, 'Europe/Budapest'))
    // A turn soon after the last, the same day: nothing again.
    assert.isFalse(timeAgain(told, at + 60_000, at + 2 * 60_000, 'Europe/Budapest'))
    assert.isFalse(timeAgain(told, at, at + HOURS - 1, 'Europe/Budapest'))
    // Its last turn ended the gap ago or more.
    assert.isTrue(timeAgain(told, at, at + HOURS, 'Europe/Budapest'))
    // Past midnight however short the gap: 23:50 told, 00:10 the next day.
    const late = Date.parse('2025-11-19T22:50:00Z')
    assert.isTrue(timeAgain({ at: late, zone: 'Europe/Budapest' }, late, late + 20 * 60_000, 'Europe/Budapest'))
    // The computer moved zones.
    assert.isTrue(timeAgain(told, at, at + 60_000, 'America/New_York'))
  })
})

/** A test whose clock starts at an instant and runs on with the wall's, so the runtime is built at that instant. */
const fromInstant = <A, E, R>(at: number, test: Effect.Effect<A, E, R>) =>
  TestClock.testClockWith((clock) =>
    Effect.gen(function* () {
      yield* clock.setTime(at)
      let last = Date.now()
      yield* Effect.forkChild(
        Effect.forever(
          Effect.andThen(
            clock.withLive(Effect.sleep(Duration.millis(10))),
            Effect.suspend(() => {
              const passed = Date.now() - last
              last += passed
              return clock.adjust(passed)
            }),
          ),
        ),
      )
      return yield* test
    }),
  )

const ZONE = 'Asia/Kolkata'

const done = (rows: ReadonlyArray<{ readonly state: string }>, count: number) =>
  rows.length >= count && rows.every((row) => !['pending', 'delivered'].includes(row.state))

/** The prompts of a thread's turns once it has `count`, all ended. */
const prompts = (threadId: string, count: number) =>
  Effect.map(
    until(turns(threadId), (rows) => done(rows, count)),
    (rows) => rows.map((row) => row.prompt ?? ''),
  )

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

describe('a lead', () => {
  it.effect('is told the local date, time and zone in its brief, and again only in the turn after a long gap', () =>
    // 13:35 in Kolkata, 08:05 UTC.
    fromInstant(
      Date.parse('2025-11-19T08:05:00Z'),
      Effect.gen(function* () {
        const { task: created } = yield* task()
        yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
        const [brief = ''] = yield* prompts(created.threadId, 1)
        assert.include(
          brief,
          "On the person's computer it is Wednesday 19 November 2025, 13:35, Asia/Kolkata: their local date, time and time zone",
        )
        assert.isTrue(brief.endsWith('Start on the task.'))
        // Soon after, the same day: the prompt stays what was said.
        yield* say(created.threadId, 'one')
        const soon = (yield* prompts(created.threadId, 2))[1] ?? ''
        assert.strictEqual(soon, 'one')
        // Back after the gap: told first, once, in that turn's own message.
        yield* TestClock.adjust(TIME_AGAIN_AFTER)
        yield* say(created.threadId, 'two')
        const back = (yield* prompts(created.threadId, 3))[2] ?? ''
        assert.strictEqual(back, "(It is now Wednesday 19 November 2025, 17:35, Asia/Kolkata on the person's computer.)\n\ntwo")
        yield* say(created.threadId, 'three')
        assert.strictEqual((yield* prompts(created.threadId, 4))[3], 'three')
      }).pipe(Effect.provide(runtime(':memory:', {}, { zone: () => ZONE }))),
    ),
  )

  it.effect('is told the date again past midnight, however short the gap', () =>
    // 23:50 in Kolkata.
    fromInstant(
      Date.parse('2025-11-19T18:20:00Z'),
      Effect.gen(function* () {
        const { task: created } = yield* task()
        yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
        const [brief = ''] = yield* prompts(created.threadId, 1)
        assert.include(brief, 'Wednesday 19 November 2025, 23:50, Asia/Kolkata')
        yield* TestClock.adjust(Duration.minutes(20))
        yield* say(created.threadId, 'still up')
        const after = (yield* prompts(created.threadId, 2))[1] ?? ''
        assert.strictEqual(after, "(It is now Thursday 20 November 2025, 00:10, Asia/Kolkata on the person's computer.)\n\nstill up")
      }).pipe(Effect.provide(runtime(':memory:', {}, { zone: () => ZONE }))),
    ),
  )

  it.effect('is told the time again before its refreshed brief in the turn after compaction', () =>
    fromInstant(
      Date.parse('2025-11-19T08:05:00Z'),
      Effect.gen(function* () {
        const { task: created } = yield* task()
        const sessions = yield* Sessions
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* prompts(created.threadId, 1)
        yield* sessions.compact({
          envelope: yield* Runtime.envelope('thread.compact', { threadId: created.threadId }),
          threadId: created.threadId,
        })
        const [, compacted] = yield* prompts(created.threadId, 2)
        assert.strictEqual(compacted, COMPACT)
        yield* say(created.threadId, 'carry on')
        const after = (yield* prompts(created.threadId, 3))[2] ?? ''
        const [first, ...rest] = after.split('\n\n')
        assert.strictEqual(first, "(It is now Wednesday 19 November 2025, 13:35, Asia/Kolkata on the person's computer.)")
        assert.include(after, "When you have done the task, call Althar's finish_step tool")
        assert.strictEqual(rest.at(-1), 'carry on')
      }).pipe(Effect.provide(runtime(':memory:', {}, { zone: () => ZONE }))),
    ),
  )

  it.effect('is told the time again when the turn after the gap that carried it never reached it, as offline', () => {
    const down: { now: 'offline' | undefined } = { now: undefined }
    return fromInstant(
      Date.parse('2025-11-19T08:05:00Z'),
      Effect.gen(function* () {
        const { task: created } = yield* task()
        yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
        yield* prompts(created.threadId, 1)
        // Back after the gap, the turn that tells it the time fails before its agent's service answers it.
        yield* TestClock.adjust(TIME_AGAIN_AFTER)
        down.now = 'offline'
        yield* say(created.threadId, 'two')
        const lost = (yield* prompts(created.threadId, 2))[1] ?? ''
        assert.isTrue(lost.startsWith('(It is now Wednesday 19 November 2025, 17:35, Asia/Kolkata'))
        // A minute later, the same day and zone and no gap since that turn ended: what it was never told goes with the retry.
        down.now = undefined
        yield* TestClock.adjust(Duration.minutes(1))
        yield* say(created.threadId, 'three')
        const retried = (yield* prompts(created.threadId, 3))[2] ?? ''
        assert.isTrue(retried.startsWith("(It is now Wednesday 19 November 2025, 17:36, Asia/Kolkata on the person's computer.)\n\n"))
        assert.include(retried, 'two')
        assert.isTrue(retried.endsWith('three'))
      }).pipe(Effect.provide(runtime(':memory:', { connection: () => down.now }, { zone: () => ZONE }))),
    )
  })
})

describe('the coordinator', () => {
  it.effect.each(['stays warm', 'sleeps'] as const)('is told the local time at first speech and after a long gap when it %s', (state) =>
    fromInstant(
      Date.parse('2025-11-19T08:05:00Z'),
      Effect.gen(function* () {
        yield* knownModels
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        const speak = (body: string) =>
          Effect.gen(function* () {
            yield* coordinator.say({
              envelope: yield* Runtime.envelope('thread.send', { body }),
              threadId,
              body,
              disposition: 'after_current',
            })
          })
        // Its brief waits for the person's first words: the time is the time they speak, not the time it started.
        yield* TestClock.adjust(Duration.minutes(30))
        yield* speak('hello')
        const [brief = ''] = yield* prompts(threadId, 1)
        assert.match(brief, /^You are the coordinator of the project /)
        assert.include(brief, "On the person's computer it is Wednesday 19 November 2025, 14:05, Asia/Kolkata")
        assert.isTrue(brief.endsWith('hello'))
        yield* speak('and now?')
        assert.notInclude((yield* prompts(threadId, 2))[1], 'It is now')
        yield* TestClock.adjust(Duration.hours(5))
        const sessions = yield* Sessions
        if (state === 'sleeps') yield* until(sessions.running(threadId), Option.isNone)
        yield* speak('good evening')
        const back = (yield* prompts(threadId, 3))[2] ?? ''
        if (state === 'sleeps') {
          assert.match(back, /^You are the coordinator of the project /)
          assert.include(back, "On the person's computer it is Wednesday 19 November 2025, 19:05, Asia/Kolkata")
        } else {
          assert.isTrue(back.startsWith("(It is now Wednesday 19 November 2025, 19:05, Asia/Kolkata on the person's computer.)\n\n"))
        }
        assert.isTrue(back.endsWith('good evening'))
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(
                ':memory:',
                {},
                {
                  zone: () => ZONE,
                  ...(state === 'stays warm' ? { idle: { coordinator: Duration.hours(6) } } : {}),
                },
              ),
            ),
          ),
        ),
      ),
    ),
  )
})
