import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { callWords, type NudgeEvent, Nudges, readyWords } from '../src/Nudges'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * What reaches the person outside the window: a nudge as something comes to
 * need them, and how many things wait, never progress.
 */

const withNudges = (database = ':memory:') => Nudges.layer.pipe(Layer.provideMerge(Queries.layer), Layer.provideMerge(runtime(database)))

/** Every event the nudges give, as they come. */
const heard = Effect.gen(function* () {
  const nudges = yield* Nudges
  const events: Array<NudgeEvent> = []
  const fiber = yield* Effect.forkChild(Stream.runForEach(nudges.events, (event) => Effect.sync(() => void events.push(event))))
  return { events, stop: Fiber.interrupt(fiber) }
})

/** A task planned for its lead alone, started at once: one that reports, or, without `[lead:finish]`, one that never does. */
const started = (title: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
    })
    yield* plans.start(planId, instance.personId)
    return task
  })

const nudged = (events: ReadonlyArray<NudgeEvent>) => events.flatMap((event) => (event._tag === 'Nudge' ? [[event.title, event.body]] : []))
const counts = (events: ReadonlyArray<NudgeEvent>) => events.flatMap((event) => (event._tag === 'Waiting' ? [event.count] : []))

describe('nudges', () => {
  it.live('say when a task is ready and when a step needs the person, with how many things wait, and less once answered', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const ready = yield* started('Retry the checkout [lead:finish]')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 1,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(nudged(events), [['Retry the checkout [lead:finish]', 'Ready: Did the task.']])
      // A step that never reports needs the person.
      yield* started('Quietly')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 2,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(nudged(events)[1], ['Quietly', 'Needs you: Implement is stuck'])
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 2,
      )
      // Answered, it waits no more.
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* sql<{ id: string }>`SELECT id FROM attention_requests WHERE state = 'open'`
      const runs = yield* Runs
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
        Duration.seconds(10),
      )
      assert.strictEqual(counts(events)[0], 0)
      assert.isNotEmpty(ready.threadId)
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('don’t say again what already waited when Charrette started, though they count it', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'charrette-nudges-')), 'profile.sqlite')
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const { events, stop } = yield* heard
        yield* started('Retry the checkout [lead:finish]')
        yield* until(
          Effect.sync(() => nudged(events)),
          (said) => said.length === 1,
          Duration.seconds(20),
        )
        yield* stop
      }).pipe(Effect.provide(withNudges(database)))
      yield* Effect.gen(function* () {
        const { events, stop } = yield* heard
        yield* until(
          Effect.sync(() => counts(events)),
          (seen) => seen.includes(1),
          Duration.seconds(10),
        )
        yield* Effect.sleep(Duration.millis(500))
        assert.deepStrictEqual(nudged(events), [])
        yield* stop
      }).pipe(Effect.provide(withNudges(database)))
    })
  })

  it('say a call as the person reads it', () => {
    const call = {
      id: 'att1',
      kind: 'permission' as const,
      title: 'Run git push',
      reason: '',
      command: 'git push',
      stuck: null,
      createdAt: '2026-10-03T12:00:00.000Z',
      taskId: 't1',
      threadId: 'th1',
      taskTitle: 'Retry',
      taskSlug: 'retry',
    }
    assert.strictEqual(callWords(call), 'Needs you: Run git push')
    const stuck = {
      ...call,
      kind: 'stuck' as const,
      stuck: { step: 'publish' as const, why: 'failed_to_start' as const, detail: null, agentId: null, round: 0, open: 0 },
    }
    assert.strictEqual(callWords(stuck), 'Needs you: Opening the pull request is stuck')
    assert.strictEqual(callWords({ ...stuck, stuck: { ...stuck.stuck, step: 'unknown' as never } }), 'Needs you: A step is stuck')
    assert.strictEqual(readyWords({ summary: null } as never), 'Ready to look at')
    assert.strictEqual(readyWords({ summary: 'Did it.\nAnd more.' } as never), 'Ready: Did it.')
  })
})
