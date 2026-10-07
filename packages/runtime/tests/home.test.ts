import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { inkFor, Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem } from '../src/threads'
import { repository, runtime, turns, until } from './support'

/*
 * The home: every project with its ink, and across them what runs, what
 * waits on the person, and what the loop did since they last left it.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

/** A task in the project, started on a plan of one step for the fake agent, as its description says. */
const planned = (projectId: string, title: string, description: string) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
    })
    yield* plans.start(planId, instance.personId)
    return task
  })

describe("a project's ink", () => {
  it('is the same for the same seed, and passes over the inks taken while one is free', () => {
    assert.strictEqual(inkFor('proj_a', []), inkFor('proj_a', []))
    const first = inkFor('proj_a', [])
    assert.notStrictEqual(inkFor('proj_a', [first]), first)
    const all = ['clay', 'ochre', 'olive', 'moss', 'teal', 'slate', 'rose', 'umber']
    assert.strictEqual(inkFor('proj_a', all), first)
    assert.strictEqual(
      inkFor(
        'proj_b',
        all.filter((ink) => ink !== 'teal'),
      ),
      'teal',
    )
  })

  it.live('is chosen when the project is made, apart from the others, and kept', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      for (let made = 0; made < 3; made++) yield* open
      const { projects } = yield* queries.projects
      assert.strictEqual(new Set(projects.map((project) => project.ink)).size, 3)
      assert.isTrue(projects.every((project) => project.lastWorkAt === null))
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('the home', () => {
  it.live('shows across projects what runs, what waits on the person, and what the loop did since they last left it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const sessions = yield* Sessions
      const instance = yield* Instance
      const before = yield* queries.home()
      assert.deepStrictEqual([before.looked, before.tasks, before.calls, before.events], [null, [], [], []])

      // One project works on a task; another has one ready, and one whose lead ended without reporting, which needs the person.
      const busy = yield* open
      const done = yield* open
      const working = yield* planned(busy.projectId, 'Retry the call', '[lead:wait]')
      const ready = yield* planned(done.projectId, 'Name it better', '[lead:finish]')
      const quiet = yield* planned(done.projectId, 'Say nothing', 'Nothing to say.')
      const home = yield* until(
        Effect.map(queries.home(), (snapshot) => [snapshot]),
        ([snapshot]) =>
          snapshot !== undefined &&
          snapshot.tasks.some((task) => task.taskId === working.taskId && task.phase === 'running') &&
          snapshot.tasks.some((task) => task.taskId === ready.taskId && task.phase === 'ready') &&
          snapshot.calls.some((call) => call.taskId === quiet.taskId),
      )
      const [snapshot] = home
      assert.deepStrictEqual(
        snapshot?.tasks.map((task) => [task.title, task.projectId]).toSorted(([a], [b]) => String(a).localeCompare(String(b))),
        [
          ['Name it better', done.projectId],
          ['Retry the call', busy.projectId],
          ['Say nothing', done.projectId],
        ],
      )
      assert.deepStrictEqual(
        snapshot?.calls.map((call) => [call.kind, call.projectId]),
        [['stuck', done.projectId]],
      )
      // The step that ended is the loop's doing; it shows with its result.
      const step = snapshot?.events.find((event) => event.kind === 'step' && event.task.id === ready.taskId)
      assert.deepInclude(step?.kind === 'step' ? step.result : {}, { step: 'implement', summary: 'Did the task.' })
      assert.strictEqual(step?.kind === 'step' ? step.projectId : null, done.projectId)
      assert.deepStrictEqual(
        snapshot?.projects.map((project) => project.lastWorkAt !== null),
        [true, true],
      )

      // A usage limit or a quiet step the loop dealt with shows; anything else it says in a thread doesn't.
      const place = { projectId: busy.projectId as Parameters<typeof addItem>[0]['projectId'], threadId: working.threadId }
      yield* addItem(place, 'notice', { source: 'runtime', severity: 'warning', title: 'Codex went quiet.', about: 'stall' })
      yield* addItem(place, 'notice', { source: 'runtime', severity: 'info', title: 'Merged into main here.' })
      const dealt = (yield* queries.home()).events.filter((event) => event.kind === 'dealt')
      assert.deepStrictEqual(
        dealt.map((event) => (event.kind === 'dealt' ? [event.about, event.title, event.task.slug] : [])),
        [['stall', 'Codex went quiet.', working.slug]],
      )

      // Asks the rules answered are counted, not listed; the person's own aren't the loop's.
      const asker = yield* planned(busy.projectId, 'Write it down', 'Nothing to say.')
      yield* until(turns(asker.threadId), (rows) => rows.length > 0)
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: asker.threadId,
        body: scenarios.tool,
        disposition: 'after_current',
      })
      yield* until(sql<{ n: number }>`SELECT count(*) AS n FROM decisions`, ([row]) => (row?.n ?? 0) > 0)
      const answered = (yield* queries.home()).events.find((event) => event.kind === 'answered')
      assert.strictEqual(answered?.kind === 'answered' ? answered.count : 0, 1)
      const [{ decidedBy } = { decidedBy: '' }] = yield* sql<{ decidedBy: string }>`SELECT decided_by_actor_id AS decided_by FROM decisions`
      assert.strictEqual(decidedBy, instance.systemId)

      // Read from a moment the window names, only what came after shows; left, the home starts from then.
      const later = new Date(Date.now() + 60_000).toISOString()
      assert.deepStrictEqual((yield* queries.home(later)).events, [])
      yield* sql`UPDATE devices SET home_looked_at = ${later} WHERE id = ${instance.deviceId}`
      const after = yield* queries.home()
      assert.deepStrictEqual([after.looked, after.since, after.events], [later, later, []])
    }).pipe(Effect.provide(withQueries())),
  )
})
