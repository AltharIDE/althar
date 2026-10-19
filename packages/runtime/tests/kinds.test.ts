import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { endsInChange, handedOf, kindOf } from '../src/kinds'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * A task's kind is read from what it has, never stored (DEV-96): a plain
 * task is a quick task, one the coordinator starts with start_task, whose
 * plan stays on this Mac and ends in nothing, with no pull request, whatever
 * its lead wrote; a review reads someone else's pull request; everything else
 * is a change, every planned task among them. A plain task that finished
 * waits on its board as Finished, and nothing else counts it; seeing it
 * settles it as done, and writing to its lead opens it again.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

/** A task on a plan of one step for the fake agent, as its description says, started at once or in an hour. */
const planned = (projectId: string, title: string, description: string, plan: { readonly end?: 'draft'; readonly later?: true } = {}) =>
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
      projectId: projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: plan.end ?? null,
      ...(plan.later === true ? { startsIn: Duration.hours(1) } : {}),
    })
    if (plan.later !== true) yield* plans.start(planId, instance.personId)
    return task
  })

/** A plain task, as the coordinator starts one with start_task: no plan to look over, and no branch until its lead writes. */
const plain = (projectId: string, title: string, description: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const threadId = yield* (yield* Coordinator).thread(projectId)
    const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
    assert.match(yield* callTool(access, 'start_task', { title, description, lead: { agent: 'codex' } }), /^Started /)
    const [task] = yield* sql<{ taskId: string; threadId: string }>`
      SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE k.project_id = ${projectId} AND k.title = ${title}`
    return task ?? assert.fail('no task')
  })

/** The task's card once it stands where `check` wants it. */
const cardOnce = (
  taskId: string,
  check: (card: { readonly phase: string; readonly kind: string; readonly keptAt?: string | null | undefined }) => boolean,
) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const [card] = yield* until(
      Effect.map(queries.card(taskId), (one) => [one]),
      ([one]) => one !== undefined && check(one),
      Duration.seconds(20),
    )
    return card ?? assert.fail('no card')
  })

const row = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ state: string; settledAt: string | null; seenAt: string | null }>`
      SELECT state, settled_at, seen_at FROM tasks WHERE id = ${taskId}`
    return task ?? assert.fail('no task')
  })

/** The person presses Done on the task, or Keep for later. Whether it moved. */
const markDone = (taskId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Tasks).markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId }), taskId })
  })
const keep = (taskId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Tasks).keep({ envelope: yield* Runtime.envelope('task.keep', { taskId }), taskId })
  })

const picture = (digest: string, name: string) => ({ sha256: digest, mediaType: 'image/png', bytes: 120, width: 8, height: 6, name })

describe("a task's kind", () => {
  it('is plain for a quick task with no pull request, whatever it made; a review with nothing of its own; else a change', () => {
    const quick = { reviewing: null, end: null, changes: 0, made: false, quick: true }
    assert.strictEqual(kindOf(quick), 'plain')
    // What its lead wrote or committed doesn't make it a change: only the person does, through its lead.
    assert.strictEqual(kindOf({ ...quick, made: true }), 'plain')
    // Made a change, its plan ends in a pull request or a pushed branch; and a pull request of its own makes it one.
    for (const end of ['draft', 'ready', 'none']) assert.strictEqual(kindOf({ ...quick, end }), 'change', end)
    assert.strictEqual(kindOf({ ...quick, changes: 1 }), 'change')
    // Any other task is a change: every planned one, whatever its end, as one that merges here has none.
    const planned = { ...quick, quick: false }
    assert.strictEqual(kindOf(planned), 'change')
    assert.strictEqual(kindOf({ ...planned, end: 'merge' }), 'change')
    const reviewing = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 12,
      url: 'https://github.com/meridian/api/pull/12',
      title: 'Retry',
      author: 'ninemate',
      outside: false,
      additions: 1,
      deletions: 0,
      findings: 0,
      blocking: 0,
      verdict: null,
      posted: null,
    }
    assert.strictEqual(kindOf({ ...planned, reviewing }), 'review')
    assert.strictEqual(kindOf({ ...planned, reviewing, end: 'draft' }), 'review')
    assert.strictEqual(kindOf({ ...quick, reviewing }), 'review')
    // A review the person takes over, with work of its own, is a change.
    assert.strictEqual(kindOf({ ...planned, reviewing, made: true }), 'change')
    assert.strictEqual(kindOf({ ...planned, reviewing, changes: 1 }), 'change')
    assert.isFalse(endsInChange(null))
  })

  it('hands back a plain task’s kept pictures from its report, and each file it named once', () => {
    const report = {
      evidence: [
        { kind: 'screenshot', caption: 'The page', picture: picture('a'.repeat(64), 'page.png') },
        { kind: 'screenshot', caption: 'Too large', picture: { why: 'too_large', mediaType: 'image/png', bytes: 1, name: 'big.png' } },
        { kind: 'test_run', caption: 'Tests', command: 'bun test', exit: 0 },
      ],
    }
    const file = (path: string) => ({ path, how: 'wrote', mediaType: 'text/markdown', bytes: 10, title: null })
    const handed = handedOf(report, [{ files: [file('/tmp/notes.md'), file('/tmp/a.csv')] }, { files: [file('/tmp/notes.md')] }, 'nothing'])
    assert.deepStrictEqual(
      handed?.pictures.map((one) => one.name),
      ['page.png'],
    )
    assert.deepStrictEqual(handed?.files, [
      { path: '/tmp/notes.md', add: null },
      { path: '/tmp/a.csv', add: null },
    ])
    assert.isNull(handedOf(null, []))
    assert.isNull(handedOf({ evidence: [] }, [{ files: [] }]))
  })

  it.live('is read from what the task has: plain for a quick task, a change for a planned one, whatever it made or how it ends', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const project = yield* open
      const question = yield* plain(project.projectId, 'Which partners still call v1?', '[lead:finish]')
      // A quick task whose lead committed: its work is on a branch of its own, and it is plain still.
      const sketch = yield* plain(project.projectId, 'Sketch the settings', '[lead:commit] [lead:finish]')
      const change = yield* planned(project.projectId, 'Retry the checkout', '[lead:finish] [lead:edit]')
      // Planned, in a project with no host, so it merges here when accepted: its plan has no end, and it makes nothing.
      const kept = yield* planned(project.projectId, 'Keep the old checkout', '[lead:finish]')
      const later = yield* planned(project.projectId, 'Sign webhooks', '', { end: 'draft', later: true })

      const plainCard = yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      assert.deepInclude(plainCard, { kind: 'plain', handed: null, reviewing: null })
      const sketched = yield* cardOnce(sketch.taskId, (card) => card.phase === 'ready')
      assert.strictEqual(sketched.kind, 'plain')
      assert.isNotNull(sketched.branch)
      assert.strictEqual((yield* cardOnce(change.taskId, (card) => card.phase === 'ready')).kind, 'change')
      // On its branch from its start, it is a change though it made nothing, and ready to accept.
      assert.strictEqual((yield* cardOnce(kept.taskId, (card) => card.phase === 'ready')).kind, 'change')
      // Its plan ends in a pull request, and it has its branch: a change before it has done anything.
      assert.deepInclude(yield* queries.card(later.taskId), { phase: 'planned', kind: 'change' })

      // Finished, a plain task waits in Needs you as a change does: the board, the home and the project's count all say it.
      const board = yield* queries.board(project.projectId)
      assert.sameDeepMembers(
        board.tasks.filter((task) => task.phase === 'ready').map((task) => [task.title, task.kind]),
        [
          ['Which partners still call v1?', 'plain'],
          ['Sketch the settings', 'plain'],
          ['Retry the checkout', 'change'],
          ['Keep the old checkout', 'change'],
        ],
      )
      const home = yield* queries.home()
      assert.sameMembers(
        home.tasks.map((task) => task.title),
        ['Which partners still call v1?', 'Sketch the settings', 'Retry the checkout', 'Keep the old checkout'],
      )
      const readyIn = Effect.map(queries.projects, (all) => all.projects.find((one) => one.id === project.projectId)?.ready)
      assert.strictEqual(yield* readyIn, 4)
      assert.lengthOf([...(yield* queries.kept)], 0)
      // Kept for later, it is out of Needs you: kept on its board, and nothing else counts it.
      assert.isTrue(yield* keep(question.taskId))
      const shelved = yield* cardOnce(question.taskId, (card) => card.phase === 'kept')
      assert.isNotNull(shelved.keptAt)
      assert.notInclude(
        (yield* queries.home()).tasks.map((task) => task.title),
        'Which partners still call v1?',
      )
      assert.strictEqual(yield* readyIn, 3)
      assert.sameMembers([...(yield* queries.kept)], [question.taskId])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('reads the same kind on its thread as on its card, with its pull requests: a quick task that opened one is a change', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const quick = yield* plain(project.projectId, 'Which partners still call v2?', '[lead:finish]')
      yield* cardOnce(quick.taskId, (card) => card.phase === 'ready')
      const kindOnThread = () => Effect.map(Effect.orDie(queries.thread(quick.threadId)), (snapshot) => snapshot.task.kind)
      assert.strictEqual(yield* kindOnThread(), 'plain')
      const at = new Date().toISOString()
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${'3'.repeat(32)}`,
        projectId: project.projectId,
        taskId: quick.taskId,
        connectionId: null,
        product: 'github',
        kind: 'change',
        externalId: '7',
        ref: '7',
        key: '7',
        url: 'https://github.com/acme/app/pull/7',
        snapshot: JSON.stringify({
          number: 7,
          title: 'v2',
          url: 'https://github.com/acme/app/pull/7',
          state: 'open',
          draft: false,
          words: {},
          repository: ['acme', 'app'],
        }),
        createdAt: at,
        updatedAt: at,
      })}`
      const card = yield* cardOnce(quick.taskId, (one) => one.kind === 'change')
      assert.strictEqual(yield* kindOnThread(), card.kind)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is a change from its start when planned, and at work shows how big its branch is so far', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const looking = yield* planned(project.projectId, 'Look around', '[lead:wait]')
      const card = yield* cardOnce(looking.taskId, (one) => one.phase === 'running')
      assert.strictEqual(card.kind, 'change')
      assert.deepInclude((yield* queries.board(project.projectId)).tasks.find((task) => task.taskId === looking.taskId)?.changed, {
        files: 0,
      })
      // Its lead writes a file in its worktree: its size is read from git.
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${looking.taskId}`
      writeFileSync(join(workspace?.path ?? '', 'notes.md'), 'one\ntwo\n')
      // As a lead's edit comes: with its tool call, which is what tells what git says is worth reading again.
      const place = { projectId: project.projectId as ProjectId, threadId: looking.threadId }
      yield* addItem(place, 'tool_call', { title: 'Write notes.md', kind: 'edit', status: 'completed' }, { toolCallId: 'write-notes' })
      const board = yield* queries.board(project.projectId)
      assert.deepInclude(
        board.tasks.find((task) => task.taskId === looking.taskId),
        {
          kind: 'change',
          changed: { files: 1, add: 2, del: 0 },
        },
      )
      yield* sessions.stop(looking.threadId)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('shows what a plain task handed back while it waits: its report’s pictures and the files it named', () =>
    Effect.gen(function* () {
      const project = yield* open
      const question = yield* plain(project.projectId, 'Prototype the empty state', '[lead:finish]')
      yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      const place = { projectId: project.projectId as ProjectId, threadId: question.threadId }
      yield* addItem(place, 'agent_message', {
        text: 'Three pages.',
        pictures: [],
        files: [{ path: '/tmp/empty-state.html', how: 'wrote', mediaType: 'text/html', bytes: 300, title: null }],
      })
      yield* addItem(place, 'step_result', {
        step: 'implement',
        round: 0,
        summary: 'Three pages.',
        verdict: null,
        findings: [],
        evidence: [{ kind: 'screenshot', caption: 'The first', picture: picture('b'.repeat(64), 'one.png') }],
      })
      const card = yield* cardOnce(question.taskId, (one) => one.phase === 'ready')
      assert.deepStrictEqual(card.handed?.files, [{ path: '/tmp/empty-state.html', add: null }])
      assert.deepStrictEqual(
        card.handed?.pictures.map((one) => [one.digest, one.name]),
        [['b'.repeat(64), 'one.png']],
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('settling a task that isn’t a change', () => {
  it.live('moves nothing when seen: a finished plain task waits in Needs you until the person marks it done', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const question = yield* plain(project.projectId, 'Which partners still call v1?', '[lead:finish]')
      const change = yield* planned(project.projectId, 'Retry the checkout', '[lead:finish] [lead:edit]')
      const working = yield* planned(project.projectId, 'Hold the line', '[lead:wait]')
      yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      yield* cardOnce(change.taskId, (card) => card.phase === 'ready')
      yield* cardOnce(working.taskId, (card) => card.phase === 'running')

      // Opened, each is only marked seen: the finished plain task too, which stays in Needs you.
      for (const taskId of [question.taskId, change.taskId, working.taskId]) {
        yield* tasks.see({ taskId })
        const seen = yield* row(taskId)
        assert.deepInclude(seen, { state: 'open', settledAt: null })
        assert.isNotNull(seen.seenAt)
      }
      assert.strictEqual((yield* queries.card(question.taskId)).phase, 'ready')

      // Done settles nothing that is a change, or at work; nor does Keep for later a change.
      assert.isFalse(yield* markDone(working.taskId))
      assert.isFalse(yield* markDone(change.taskId))
      assert.isFalse(yield* keep(change.taskId))
      assert.strictEqual((yield* row(change.taskId)).state, 'open')
      assert.strictEqual((yield* row(working.taskId)).state, 'open')

      // The person marks the plain task done: settled, recorded as theirs.
      assert.isTrue(yield* markDone(question.taskId))
      const done = yield* row(question.taskId)
      assert.strictEqual(done.state, 'done')
      assert.isNotNull(done.settledAt)
      assert.deepInclude(yield* queries.card(question.taskId), { phase: 'settled', kind: 'plain' })
      const [recorded] = yield* sql<{ payload: string }>`
        SELECT payload FROM record_events WHERE aggregate_id = ${question.taskId} AND type = 'task.done'`
      assert.deepStrictEqual(JSON.parse(recorded?.payload ?? '{}'), { marked: true })
      // Pressed again, nothing more happens.
      assert.isFalse(yield* markDone(question.taskId))
      yield* (yield* Sessions).stop(working.threadId)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('ends a round after Done, or after Keep for later, in Needs you, never straight back in Settled', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const question = yield* plain(project.projectId, 'Which partners still call v1?', '[lead:finish]')
      yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      // What the window does as the person writes to it.
      const write = (body: string) =>
        Effect.gen(function* () {
          yield* tasks.bringBack(question.taskId)
          yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', { threadId: question.threadId, body }),
            threadId: question.threadId,
            body,
          })
        })
      const roundsEnded = (n: number) =>
        until(
          sql<{ n: number }>`SELECT count(*) AS n FROM runs WHERE task_id = ${question.taskId} AND plan_id IS NULL AND state <> 'running'`,
          (rows) => (rows[0]?.n ?? 0) === n,
          Duration.seconds(30),
        )

      // Done, then written to: it goes back to work as a round, which makes nothing, and it waits in Needs you.
      assert.isTrue(yield* markDone(question.taskId))
      yield* write('And the v2 ones? [lead:slowly]')
      yield* roundsEnded(1)
      yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      assert.deepInclude(yield* row(question.taskId), { state: 'open', settledAt: null })

      // Kept for later, then written to: it is back, and its round ends in Needs you too.
      assert.isTrue(yield* keep(question.taskId))
      yield* cardOnce(question.taskId, (card) => card.phase === 'kept')
      yield* write('And the v3 ones? [lead:slowly]')
      yield* roundsEnded(2)
      const back = yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      assert.isUndefined(back.keptAt)
      assert.strictEqual((yield* row(question.taskId)).state, 'open')
    }).pipe(Effect.provide(withQueries())),
  )
})
