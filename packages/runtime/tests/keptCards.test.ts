import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import { readClock } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Tracer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Setups } from '../src/Setups'
import { Tasks } from '../src/Tasks'
import { retitleTask } from '../src/taskTitle'
import { addItem } from '../src/threads'
import { boardProjections } from '../src/boardProjections'
import { repository, runtime, until } from './support'

/*
 * A board's cards are kept between reads until their task moves (Queries.ts):
 * a read after one task changed works out that card alone, as the card
 * watcher worked it out already, or the read itself where it is ahead of
 * the watcher; and no read gives out a card older than what it has seen of
 * the store, nor one whose moment, by its time, is over.
 */

/** The statement a board reads its tasks with, once a read. */
const BOARD_ROWS = 'SELECT k.id, k.state, k.created_at, k.settled_at, k.kept_at, w.path AS worktree'

/** Each card worked out, as its span says: its task, and whether it was kept, or why not; and how many boards were read. */
const cardsWorkedOut = () => {
  const seen: Array<{ readonly taskId: string; readonly kept: boolean; readonly unsure: string | undefined }> = []
  let boards = 0
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      const end = span.end.bind(span)
      span.end = (endTime, exit) => {
        end(endTime, exit)
        const text = span.attributes.get('db.query.text')
        if (typeof text === 'string' && text.includes(BOARD_ROWS)) boards += 1
        if (span.name !== 'Queries.card') return
        const unsure = span.attributes.get('unsure')
        seen.push({
          taskId: String(span.attributes.get('taskId')),
          kept: span.attributes.get('kept') === true,
          unsure: typeof unsure === 'string' ? unsure : undefined,
        })
      }
      return span
    },
  })
  return {
    layer: Layer.succeed(Tracer.Tracer, tracer),
    /** What was worked out since it was last asked. */
    since: () => seen.splice(0),
    /** How many boards were read since it was last asked. */
    boards: () => {
      const read = boards
      boards = 0
      return read
    },
  }
}

/** The runtime, keeping cards an hour at most; a task between agents a minute after its last went, which is less. */
const keeping = Queries.layer.pipe(
  Layer.provideMerge(runtime(':memory:', {}, { keptFor: Duration.hours(1), betweenAgents: Duration.minutes(1) })),
)

/** A project with tasks of these titles, nothing begun of any: each its id and its thread's. */
const tasks = (...titles: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const made = yield* Effect.forEach(titles, (title) =>
      Effect.flatMap(Runtime.envelope('task.create', { title }), (envelope) =>
        projects.createTask({ envelope, projectId: project.projectId, title, plain: true }),
      ),
    )
    // Their worktrees set up, as they are as they are made: nothing moves them after.
    const setups = yield* Setups
    yield* Effect.forEach(made, (one) => setups.ready(one.taskId))
    return { projectId: project.projectId, made }
  })

/** Waits for the card watcher to have said each task's card, since `from`: what was recorded of them is worked out. */
const watched = (from: number, taskIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    yield* until(
      queries.changesSince(from, 1000),
      (changes) => taskIds.every((taskId) => changes.some((change) => change.aggregateType === 'card' && change.aggregateId === taskId)),
      'the watcher to say each card',
    )
  })

/** Waits until nothing moves a board's cards any more, their worktrees made: a read of it works none of them out. */
const quiet = (projectId: string, traced: ReturnType<typeof cardsWorkedOut>) =>
  until(
    Effect.gen(function* () {
      traced.since()
      yield* (yield* Queries).board(projectId)
      return traced.since()
    }),
    (worked) => worked.length === 0,
    'the cards to be kept',
  )

/** A change its lead is at work on, with no pull request yet: its card says how big its branch is so far, from git. */
const atWork = (traced: ReturnType<typeof cardsWorkedOut>) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const projects = yield* Projects
    const plans = yield* Plans
    const actor = (yield* Instance).personId
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const projectId = project.projectId
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'Add a retry',
      description: '[lead:wait]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    const cardOf = Effect.map(queries.board(projectId), (board) => board.tasks.find((one) => one.taskId === task.taskId))
    yield* until(cardOf, (card) => card?.phase === 'running' && card.changed !== null, 'its lead at work')
    yield* quiet(projectId, traced)
    return { projectId, taskId: task.taskId, cardOf }
  })

const titleIn = (board: { readonly tasks: ReadonlyArray<{ readonly taskId: string; readonly title: string }> }, taskId: string) =>
  board.tasks.find((task) => task.taskId === taskId)?.title

describe('a board read after one task moved', () => {
  it.live('shows durable facts for unusable projections and bounds the saved-card cache', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { projectId } = yield* tasks('Add a retry')
      const [card] = (yield* queries.board(projectId)).tasks
      assert.isDefined(card)
      const projections = yield* boardProjections
      const { taskId: id, state, createdAt, settledAt } = card!
      const row = { id, state, createdAt, settledAt, view: JSON.stringify([card]) }
      const facts = [{ ...card!, title: 'Durable facts' }]
      const fallback = Effect.succeed(facts)
      assert.strictEqual(yield* projections.read({ ...row, view: null }, fallback), facts)
      assert.strictEqual(yield* projections.read({ ...row, view: '{}' }, fallback), facts)
      assert.strictEqual(yield* projections.read({ ...row, state: 'done' }, fallback), facts)
      assert.strictEqual(yield* projections.read({ ...row, settledAt: '2026-10-05T12:00:00Z' }, fallback), facts)
      // Kept for later since the card was saved, or brought back since one saved kept: its state and settling the same, but
      // the card it saved no longer stands (Keep for later's read after its answer).
      const keptAt = '2026-10-05T12:00:00Z'
      assert.strictEqual(yield* projections.read({ ...row, keptAt }, fallback), facts)
      const keptView = JSON.stringify([{ ...card!, phase: 'kept', keptAt }])
      assert.strictEqual(yield* projections.read({ ...row, view: keptView, keptAt: null }, fallback), facts)
      assert.strictEqual((yield* projections.read({ ...row, view: keptView, keptAt }, fallback))[0]?.phase, 'kept')
      // Saved as it read after a pull request of it opened, kept still: ready, and it stands, by when it was kept.
      const openedView = JSON.stringify([{ ...card!, phase: 'ready', keptAt }])
      assert.strictEqual((yield* projections.read({ ...row, view: openedView, keptAt }, fallback))[0]?.phase, 'ready')
      assert.deepEqual(projections.pending(10), [id])

      const saved = yield* projections.read(row, fallback)
      assert.deepEqual(saved, [card])
      assert.strictEqual(yield* projections.read(row, fallback), saved)
      yield* projections.checked(id)
      for (let index = 0; index < 1_000; index += 1) {
        const other = `task-${index}`
        yield* projections.read({ ...row, id: other, view: JSON.stringify([{ ...card, taskId: other }]) }, fallback)
        yield* projections.checked(other)
      }
      assert.deepEqual(projections.pending(10), [])
      const reread = yield* projections.read(row, fallback)
      assert.deepEqual(reread, [card])
      assert.notStrictEqual(reread, saved)
      assert.deepEqual(projections.pending(10), [id])
    }).pipe(Effect.provide(keeping)),
  )

  it.live('serves completed projections and publishes a replacement when one task changes', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const started = yield* queries.cursor
      const { projectId, made } = yield* tasks('First task', 'Second task')
      const first = made[0]!.taskId
      yield* watched(
        started,
        made.map((task) => task.taskId),
      )
      yield* quiet(projectId, traced)
      traced.since()
      assert.strictEqual(titleIn(yield* queries.board(projectId, true), first), 'First task')
      yield* queries.home(undefined, undefined, true)
      assert.deepStrictEqual(traced.since(), [])

      const before = yield* queries.cursor
      yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId: first, title: 'Renamed' })
      yield* watched(before, [first])
      traced.since()
      assert.strictEqual(titleIn(yield* queries.board(projectId, true), first), 'Renamed')
      assert.deepStrictEqual(traced.since(), [])
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })

  it.live('works out that card alone, and none as the watcher has it already', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const from = yield* queries.cursor
      const { projectId, made } = yield* tasks('Add a retry', 'Cache the config', 'Tidy the docs')
      const ids = made.map((one) => one.taskId)
      yield* watched(from, ids)
      assert.sameMembers(
        (yield* queries.board(projectId)).tasks.map((task) => task.taskId),
        ids,
      )
      // Each card worked out is kept: once nothing moves them, nothing is worked out however often they are read.
      yield* quiet(projectId, traced)
      yield* queries.board(projectId)
      yield* queries.home()
      yield* queries.coordinator(projectId)
      assert.deepStrictEqual(traced.since(), [])

      // One task moves: its card alone is worked out, by the watcher or the read, and the board says so.
      const moved = ids[1] ?? ''
      const before = yield* queries.cursor
      yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId: moved, title: 'Cache the config, renamed' })
      const after = yield* queries.board(projectId)
      assert.strictEqual(titleIn(after, moved), 'Cache the config, renamed')
      yield* watched(before, [moved])
      const worked = traced.since()
      assert.isAbove(worked.length, 0)
      assert.deepStrictEqual([...new Set(worked.map((one) => one.taskId))], [moved])
      assert.isTrue(worked.every((one) => one.kept))
      // The watcher has it: the window reading again on what it said works nothing out.
      yield* queries.board(projectId)
      yield* queries.home()
      assert.deepStrictEqual(traced.since(), [])
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })
})

describe('a board read while the same one is under way', () => {
  it.live('waits for it, where nothing was written since it began', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      // A card that stands on git, which is looked at again as it is read: each read waits for the disk a moment.
      const { projectId } = yield* atWork(traced)
      traced.boards()
      // Three windows read it on the same change: it is read once, and each has it.
      const read = yield* Effect.all([queries.board(projectId), queries.board(projectId), queries.board(projectId)], {
        concurrency: 'unbounded',
      })
      assert.strictEqual(traced.boards(), 1)
      assert.deepStrictEqual(read[1], read[0])
      assert.deepStrictEqual(read[2], read[0])
      // Once it has answered, a read is its own.
      yield* queries.board(projectId)
      yield* queries.board(projectId)
      assert.strictEqual(traced.boards(), 2)
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })
})

describe('a board read far behind the feed', () => {
  it.live('gives out no kept card until the feed is read, and waits on none of it', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const from = yield* queries.cursor
      const { projectId, made } = yield* tasks('Add a retry')
      const taskId = made[0]?.taskId ?? ''
      yield* watched(from, [taskId])
      yield* quiet(projectId, traced)
      // A store's history the watcher hasn't read yet, as at a first launch: far more than a read reads on its way.
      yield* sql.unsafe(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
         INSERT INTO change_log (project_id, aggregate_type, aggregate_id, aggregate_revision, changed_at)
         SELECT NULL, 'setting', 'set_' || printf('%032x', i), 1, '2026-10-01T09:00:00.000Z' FROM n`,
      )
      // Its card is worked out afresh, as nothing it waited for says whether one kept still holds.
      assert.strictEqual(titleIn(yield* queries.board(projectId), taskId), 'Add a retry')
      assert.deepStrictEqual(
        traced.since().map((one) => one.taskId),
        [taskId],
      )
      // Once the watcher has read it, cards are kept again.
      const before = yield* queries.cursor
      yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId, title: 'Add a retry, renamed' })
      yield* watched(before, [taskId])
      traced.since()
      assert.strictEqual(titleIn(yield* queries.board(projectId), taskId), 'Add a retry, renamed')
      assert.deepStrictEqual(traced.since(), [])
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })
})

describe('a kept card', () => {
  it.live('is never older than what its read has seen of the store, ahead of the watcher or not', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const from = yield* queries.cursor
      const { projectId, made } = yield* tasks('Add a retry')
      const taskId = made[0]?.taskId ?? ''
      yield* watched(from, [taskId])
      assert.strictEqual(titleIn(yield* queries.board(projectId), taskId), 'Add a retry')
      // Read as soon as it is renamed: whoever works it out, every read after the rename says the new name.
      for (const title of ['Add a retry, once', 'Add a retry, twice']) {
        yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId, title })
        assert.strictEqual(titleIn(yield* queries.board(projectId), taskId), title)
        assert.strictEqual(titleIn(yield* queries.home(), taskId), title)
        assert.strictEqual((yield* queries.card(taskId)).title, title)
      }
    }).pipe(Effect.provide(keeping)),
  )

  it.live('is worked out again once the time it read says otherwise, with nothing recorded', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const from = yield* queries.cursor
      const { projectId, made } = yield* tasks('Add a retry')
      const task = made[0] ?? { taskId: '', threadId: '' }
      yield* watched(from, [task.taskId])
      yield* quiet(projectId, traced)
      // Its agent went just now, with nothing that says why: it is under way a moment, as the next is on its way.
      const clock = yield* readClock
      const now = yield* clock.run(Effect.clockWith((one) => Effect.sync(() => one.currentTimeMillisUnsafe())))
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: yield* newId(Ids.providerSession),
        projectId,
        threadId: task.threadId,
        agentId: 'codex',
        state: 'completed',
        startedAt: new Date(now - 60_000).toISOString(),
        endedAt: new Date(now).toISOString(),
      })}`
      yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId: task.taskId, title: 'Add a retry, again' })
      const phaseOf = Effect.map(
        clock.run(queries.board(projectId)),
        (board) => board.tasks.find((one) => one.taskId === task.taskId)?.phase,
      )
      assert.strictEqual(yield* phaseOf, 'running')
      traced.since()
      assert.strictEqual(yield* phaseOf, 'running')
      assert.deepStrictEqual(traced.since(), [])
      // That moment over, nothing else moved: the read works its card out again, and it is the person's.
      yield* clock.advance(Duration.seconds(61))
      assert.strictEqual(yield* phaseOf, 'stopped')
      assert.deepStrictEqual(
        traced.since().map((one) => one.taskId),
        [task.taskId],
      )
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })

  it.live('is worked out again once git says otherwise, with nothing recorded, as a commit made by hand', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { taskId, cardOf } = yield* atWork(traced)
      assert.deepStrictEqual((yield* cardOf)?.changed, { files: 0, add: 0, del: 0 })
      // Committed by hand in its worktree, which no change says: the next read works its card out again, and says so.
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      const worktree = workspace?.path ?? ''
      writeFileSync(join(worktree, 'retry.ts'), 'retry\n')
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: worktree })
      git('add', '.')
      git('commit', '-q', '-m', 'Write retry.ts')
      assert.deepStrictEqual((yield* cardOf)?.changed, { files: 1, add: 1, del: 0 })
      assert.deepStrictEqual(
        traced.since().map((one) => [one.taskId, one.kept]),
        [[taskId, true]],
      )
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })

  it.live('is worked out again as the person reads the reply that kept it in Needs you', () => {
    const traced = cardsWorkedOut()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const from = yield* queries.cursor
      const { projectId, made } = yield* tasks('Add a retry')
      const task = made[0] ?? { taskId: '', threadId: '' }
      yield* watched(from, [task.taskId])
      // Its lead answered in a turn the person hasn't seen: its card waits in Needs you with the reply.
      const at = new Date().toISOString()
      const sessionId = yield* newId(Ids.providerSession)
      const deliveryId = yield* newId(Ids.turnDelivery)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId: task.threadId, agentId: 'codex', state: 'completed', startedAt: at, endedAt: at })}`
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({
        id: deliveryId,
        projectId,
        threadId: task.threadId,
        providerSessionId: sessionId,
        controllerGeneration: 1,
        state: 'completed',
        requestedAt: at,
        deliveredAt: at,
        endedAt: at,
        origin: 'person',
        heads: '{}',
      })}`
      yield* addItem({ projectId: projectId as ProjectId, threadId: task.threadId, sessionId, deliveryId }, 'agent_message', {
        text: 'Done.',
      })
      const cardOf = Effect.map(queries.board(projectId), (board) => board.tasks.find((one) => one.taskId === task.taskId))
      yield* until(cardOf, (card) => card?.replied !== undefined, 'its reply waiting')
      yield* quiet(projectId, traced)
      // Seen, which is no change of its own: its card is read again, and the reply waits no more.
      yield* (yield* Tasks).see({ taskId: task.taskId })
      assert.isUndefined((yield* cardOf)?.replied)
    }).pipe(Effect.provide(keeping), Effect.provide(traced.layer))
  })
})
