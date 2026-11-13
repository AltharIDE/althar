import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChangeSummary } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { type FakeAgentOptions, holds } from '@althar/provider-adapters/testing'
import { Ledger } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { callWords, type NudgeEvent, Nudges, readyBody, readyWords } from '../src/Nudges'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import { shelve } from '../src/scratch'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * What reaches the person outside the window: a nudge as something comes to
 * need them, and how many things wait, never progress.
 */

const withNudges = (database = ':memory:', agents: FakeAgentOptions = {}) =>
  Nudges.layer.pipe(Layer.provideMerge(Queries.layer), Layer.provideMerge(runtime(database, agents)))

/** Every event the nudges give, as they come. */
const heard = Effect.gen(function* () {
  const nudges = yield* Nudges
  const events: Array<NudgeEvent> = []
  const fiber = yield* Effect.forkChild(Stream.runForEach(nudges.events, (event) => Effect.sync(() => void events.push(event))))
  return { events, stop: Fiber.interrupt(fiber) }
})

/**
 * A task planned for its lead alone, started at once: one that reports, or, without `[lead:finish]`, one that never does.
 * `plain`, as the coordinator's start_task makes one: a quick task, its plan staying on this Mac, with no branch until its lead
 * changes the repository.
 */
const started = (title: string, plain = false) =>
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
      ...(plain ? { plain } : {}),
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
      ...(plain ? { here: true } : {}),
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
      const ready = yield* started('Retry the checkout [lead:finish] [lead:edit]')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 1,
      )
      assert.deepStrictEqual(nudged(events), [['Retry the checkout [lead:finish] [lead:edit]', 'Ready: Did the task.']])
      // A step that never reports needs the person.
      yield* started('Quietly')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 2,
      )
      assert.deepStrictEqual(nudged(events)[1], ['Quietly', 'Needs you: Implement is stuck'])
      // Each by what it is about, so the app tells only what the person asked to be told.
      assert.deepStrictEqual(kinds(events), ['ready', 'stopped'])
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 2,
      )
      // Its step given up, the call is answered, and the task stopped waits on the person still, as its board's Needs you
      // shows it; abandoned, it waits no more.
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* sql<{ id: string; taskId: string }>`SELECT id, task_id FROM attention_requests WHERE state = 'open'`
      const runs = yield* Runs
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      const queries = yield* Queries
      yield* until(
        Effect.map(queries.card(call?.taskId ?? ''), (card) => [card.phase]),
        ([phase]) => phase === 'stopped',
      )
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 2,
      )
      const taskId = call?.taskId ?? ''
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId }), taskId })
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      assert.strictEqual(counts(events)[0], 0)
      assert.isNotEmpty(ready.threadId)
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('say and count a plain task that finished, as any task ready, until the person keeps it for later', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      // A question, with no branch and no pull request at its end: it waits in Needs you, said and counted.
      const plain = yield* started('Which partners still call v1? [lead:finish]', true)
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 1,
      )
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      assert.deepStrictEqual(nudged(events), [['Which partners still call v1? [lead:finish]', 'Ready: Did the task.']])
      // Kept for later, it is out of Needs you: no longer counted.
      const tasks = yield* Tasks
      assert.isTrue(yield* tasks.keep({ envelope: yield* Runtime.envelope('task.keep', { taskId: plain.taskId }), taskId: plain.taskId }))
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 0,
      )
      // Then a change that is ready: said, and counted alone.
      yield* started('Retry the checkout [lead:finish] [lead:edit]')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 2,
      )
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      assert.strictEqual(counts(events).at(-1), 1)
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('go quiet while the lead works on what the person said after, and say the task is ready again once it is done', () => {
    const lead = holds()
    return Effect.gen(function* () {
      const { events, stop } = yield* heard
      const task = yield* started('Retry the checkout [lead:finish] [lead:edit]')
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      const sessions = yield* Sessions
      const body = 'And log each retry. [lead:wait]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
        disposition: 'after_current',
      })
      // Mid-turn, the task isn't ready; once the lead is done with it, it is again.
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 0,
      )
      lead.open('[lead:wait]')
      yield* until(
        Effect.sync(() => nudged(events)),
        (said) => said.length === 2,
      )
      // Its lead answered the person, unread: said in its card's word.
      assert.deepStrictEqual(nudged(events)[1], ['Retry the checkout [lead:finish] [lead:edit]', 'Replied'])
      yield* stop
    }).pipe(Effect.provide(withNudges(':memory:', { holds: lead })))
  })

  it.live('say whether work runs: an agent on a step, or the lead talking after its run, and not once it is stuck, stopped or done', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const last = (want: boolean) =>
        until(
          Effect.sync(() => busy(events)),
          (seen) => seen.at(-1) === want,
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
      const task = yield* started('Retry the checkout [lead:finish] [lead:edit]')
      yield* until(
        Effect.sync(() => kinds(events)),
        (said) => said.includes('ready'),
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

  it.live('say work runs while a plan counts down to its start, and not once it is held', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Later',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
        startsIn: Duration.hours(1),
      })
      yield* until(
        Effect.sync(() => busy(events)),
        (seen) => seen.at(-1) === true,
      )
      yield* plans.hold(planId, instance.personId)
      yield* until(
        Effect.sync(() => busy(events)),
        (seen) => seen.at(-1) === false,
      )
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('don’t say again what already waited when Althar started, though they count it', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-nudges-')), 'profile.sqlite')
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const { events, stop } = yield* heard
        yield* started('Retry the checkout [lead:finish] [lead:edit]')
        yield* until(
          Effect.sync(() => nudged(events)),
          (said) => said.length === 1,
        )
        yield* stop
      }).pipe(Effect.provide(withNudges(database)))
      yield* Effect.gen(function* () {
        const { events, stop } = yield* heard
        yield* until(
          Effect.sync(() => counts(events)),
          (seen) => seen.includes(1),
        )
        yield* Effect.sleep(Duration.millis(500))
        assert.deepStrictEqual(nudged(events), [])
        yield* stop
      }).pipe(Effect.provide(withNudges(database)))
    })
  })

  it.live('count a task whose lead stopped with no agent on it, as its board puts it in Needs you, and say nothing of it', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const queries = yield* Queries
      const held = yield* started('Hold the line [lead:wait]')
      yield* until(
        Effect.map(queries.card(held.taskId), (card) => [card.phase]),
        ([phase]) => phase === 'running',
      )
      yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: held.taskId })
      yield* until(
        Effect.map(queries.card(held.taskId), (card) => [card.phase]),
        ([phase]) => phase === 'stopped',
      )
      // One thing waits on the person, as the board's Needs you and its tab count it; the person stopped it, so none is said.
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      assert.deepStrictEqual(nudged(events), [])
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('count a finished task as it moves between Scratch and the board, either way', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const instance = yield* Instance
      const task = yield* started('Which partners call v1? [lead:finish]', true)
      const last = (want: number) =>
        until(
          Effect.sync(() => counts(events)),
          (seen) => seen.at(-1) === want,
        )
      yield* last(1)
      // On Scratch it is an aside, off the board's Needs you, and so off the Dock's count; back on the board, it counts again.
      yield* shelve(task.taskId, 'scratch', instance.personId)
      yield* last(0)
      yield* shelve(task.taskId, null, instance.personId)
      yield* last(1)
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

  it.live('count nothing of a project once it is archived, its calls neither', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const task = yield* started('Quietly')
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 1,
      )
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${task.taskId}`
      yield* sql`UPDATE projects SET archived_at = ${new Date().toISOString()} WHERE id = ${row?.projectId ?? ''}`
      yield* (yield* Ledger).notify({
        projectId: row?.projectId as never,
        aggregateType: 'project',
        aggregateId: row?.projectId ?? '',
        aggregateRevision: 2,
      })
      yield* until(
        Effect.sync(() => counts(events)),
        (seen) => seen.at(-1) === 0,
      )
      yield* stop
    }).pipe(Effect.provide(withNudges())),
  )

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
    assert.strictEqual(
      stuck({ step: 'review', why: 'usage_limit', agentId: 'codex' }),
      'Needs you: Codex ran out of usage during the review',
    )
    assert.strictEqual(
      stuck({ step: 'review', why: 'usage_limit', agentId: 'aider' }),
      'Needs you: aider ran out of usage during the review',
    )
    assert.strictEqual(
      stuck({ step: 'implement', why: 'waiting_on_person', detail: 'Which ADRs should the compaction keep?' }),
      'Needs you: Which ADRs should the compaction keep?',
    )
    assert.strictEqual(readyWords(''), 'Ready to look at')
    assert.strictEqual(readyWords('Did it.\nAnd more.'), 'Ready: Did it.')
  })

  it('say a ready task in its card’s word, never Ready where the card says otherwise', () => {
    const summary = 'Did it.'
    const failing = { outcome: 'failed', passed: 0, failed: 1, running: 0, total: 1, failing: ['test'], list: [] }
    const open = {
      state: 'open',
      diverged: null,
      localHead: null,
      unpushed: 0,
      conflicts: false,
      checks: failing,
    } as unknown as ChangeSummary
    assert.deepStrictEqual(
      [
        readyBody({ kind: 'change', summary, change: null }),
        readyBody({ kind: 'plain', summary }),
        readyBody({ kind: 'change', summary, change: open }),
        readyBody({ kind: 'change', summary, change: null, handedBack: 'Couldn’t resolve it.' }),
        readyBody({ kind: 'change', summary, change: null, replied: '2026-11-12T09:00:00.000Z' }),
        readyBody({ kind: 'change', summary, afterMerge: { state: 'found', findings: 2 } }),
        readyBody({ kind: 'change', summary, held: { commits: 1 } }),
      ],
      ['Ready: Did it.', 'Ready: Did it.', 'Not ready to accept', 'Merge conflict', 'Replied', 'Review found 2', 'Not shipped'],
    )
  })
})
