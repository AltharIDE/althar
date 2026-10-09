import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { callWords, type NudgeEvent, Nudges, readyWords } from '../src/Nudges'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Runs } from '../src/Runs'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * What reaches the person outside the window: a nudge as something comes to
 * need them, and how many things wait, never progress.
 */

const withNudges = (database = ':memory:') => Nudges.layer.pipe(Layer.provideMerge(runtime(database)))

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
const kinds = (events: ReadonlyArray<NudgeEvent>) => events.flatMap((event) => (event._tag === 'Nudge' ? [event.kind] : []))
const counts = (events: ReadonlyArray<NudgeEvent>) => events.flatMap((event) => (event._tag === 'Waiting' ? [event.count] : []))
const busy = (events: ReadonlyArray<NudgeEvent>) => events.flatMap((event) => (event._tag === 'Working' ? [event.working] : []))

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
      // Each by what it is about, so the app tells only what the person asked to be told.
      assert.deepStrictEqual(kinds(events), ['ready', 'stopped'])
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

  it.live('go quiet while the lead works on what the person said after, and say the task is ready again once it is done', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const task = yield* started('Retry the checkout [lead:finish]')
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
        Duration.seconds(20),
      )
      const sessions = yield* Sessions
      const body = 'And log each retry. [lead:wait]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
        disposition: 'after_current',
      })
      // Mid-turn, the task isn't ready.
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 0,
        Duration.seconds(10),
      )
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 2,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(nudged(events)[1], ['Retry the checkout [lead:finish]', 'Ready: Did the task.'])
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('say whether work runs: an agent on a step, or the lead talking after its run, and not once it is stuck, stopped or done', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const last = (want: boolean) =>
        until(
          Effect.sync(() => busy(events)),
          (seen) => seen.at(-1) === want,
          Duration.seconds(20),
        )
      // Nothing runs before the first task.
      yield* last(false)
      // A step its agent is on runs; stopped, its agent is gone and nothing runs.
      const sessions = yield* Sessions
      const held = yield* started('Hold the line [lead:wait]')
      yield* last(true)
      yield* sessions.stop(held.threadId)
      yield* last(false)
      // Stuck on the person, nothing runs either.
      yield* started('Quietly')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.some(([title]) => title === 'Quietly'),
        Duration.seconds(20),
      )
      yield* last(false)
      // Abandoned, still nothing.
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* sql<{ id: string }>`
        SELECT a.id FROM attention_requests a JOIN tasks k ON k.id = a.task_id WHERE a.state = 'open' AND k.title = 'Quietly'`
      const runs = yield* Runs
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      yield* last(false)
      // A task ready, its run over; its lead at work on what the person said after is work running too.
      const task = yield* started('Retry the checkout [lead:finish]')
      yield* until(
        Effect.sync(() => kinds(events)),
        (said) => said.includes('ready'),
        Duration.seconds(20),
      )
      yield* last(false)
      const body = 'And log each retry. [lead:wait]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
        disposition: 'after_current',
      })
      yield* last(true)
      yield* sessions.interrupt(task.threadId)
      yield* last(false)
      // Only changes are said.
      assert.isTrue(busy(events).every((working, at, all) => at === 0 || working !== all[at - 1]))
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('don’t say again what already waited when Althar started, though they count it', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-nudges-')), 'profile.sqlite')
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

  it('say a call as the person reads it, never with what a command was given', () => {
    const named = [{ definition: { id: 'codex', name: 'Codex' } }]
    const permission = (payload: object) => callWords({ kind: 'permission', payload }, named)
    assert.strictEqual(
      permission({
        kind: 'execute',
        command: 'VERCEL_TOKEN=s3cr3t-t0ken npx vercel deploy --token s3cr3t-t0ken',
        reason: 'Deploying or publishing always asks.',
      }),
      'Needs you: npx vercel',
    )
    assert.strictEqual(permission({ kind: 'execute', command: 'cd web && vercel deploy --prod' }), 'Needs you: vercel deploy')
    assert.strictEqual(permission({ kind: 'execute', command: 'deploy-tool 9f86d081884c7d659a2feaa0c55ad015' }), 'Needs you: deploy-tool')
    assert.strictEqual(permission({ kind: 'execute', command: 'git push origin main' }), 'Needs you: git push')
    assert.strictEqual(
      permission({ kind: 'edit', command: 'Edit /etc/hosts', reason: "Writing outside the task's worktree always asks: /etc/hosts" }),
      "Needs you: Writing outside the task's worktree always asks: /etc/hosts",
    )
    assert.strictEqual(permission({}), 'Needs you: An agent asks first')
    assert.strictEqual(
      permission({ kind: 'execute', command: 'cd ..', reason: 'Git in another folder always asks: /x' }),
      'Needs you: Git in another folder always asks: /x',
    )
    const stuck = (payload: object) => callWords({ kind: 'stuck', payload }, named)
    assert.strictEqual(stuck({ step: 'publish', why: 'failed_to_start' }), 'Needs you: Opening the pull request is stuck')
    assert.strictEqual(stuck({ step: 'review', why: 'usage_limit', agentId: 'codex' }), 'Needs you: Codex reached its usage limit')
    assert.strictEqual(stuck({ step: 'review', why: 'usage_limit', agentId: 'aider' }), 'Needs you: aider reached its usage limit')
    assert.strictEqual(readyWords(''), 'Ready to look at')
    assert.strictEqual(readyWords('Did it.\nAnd more.'), 'Ready: Did it.')
  })
})
