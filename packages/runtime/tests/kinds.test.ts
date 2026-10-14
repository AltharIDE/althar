import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { endsInChange, handedOf, kindOf } from '../src/kinds'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { addItem } from '../src/threads'
import { repository, runtime, until } from './support'

/*
 * A task's kind is read from what it has, never stored (DEV-96): a change
 * has a pull request, commits or changes on its branch, or a plan that ends
 * in one; anything else is plain. A plain task that finished waits on its
 * board as Finished, and nothing else counts it; seeing it settles it as
 * done, and writing to its lead opens it again.
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

/** The task's card once it stands where `check` wants it. */
const cardOnce = (taskId: string, check: (card: { readonly phase: string }) => boolean) =>
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

const picture = (digest: string, name: string) => ({ sha256: digest, mediaType: 'image/png', bytes: 120, width: 8, height: 6, name })

describe("a task's kind", () => {
  it('is a change once it has, or will have, a pull request or work of its own; a review with nothing of its own; else plain', () => {
    const none = { reviewing: null, end: null, changes: 0, made: false }
    assert.strictEqual(kindOf(none), 'plain')
    for (const end of ['draft', 'ready', 'none']) assert.strictEqual(kindOf({ ...none, end }), 'change', end)
    assert.strictEqual(kindOf({ ...none, end: 'merge' }), 'plain')
    assert.strictEqual(kindOf({ ...none, changes: 1 }), 'change')
    assert.strictEqual(kindOf({ ...none, made: true }), 'change')
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
    assert.strictEqual(kindOf({ ...none, reviewing }), 'review')
    assert.strictEqual(kindOf({ ...none, reviewing, end: 'draft' }), 'review')
    // A review the person takes over, with work of its own, is a change.
    assert.strictEqual(kindOf({ ...none, reviewing, made: true }), 'change')
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

  it.live('is read from what the task has: plain until it makes something, a change once it does, or plans to', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const project = yield* open
      const question = yield* planned(project.projectId, 'Which partners still call v1?', '[lead:finish]')
      const change = yield* planned(project.projectId, 'Retry the checkout', '[lead:finish] [lead:edit]')
      const later = yield* planned(project.projectId, 'Sign webhooks', '', { end: 'draft', later: true })

      const plain = yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      assert.deepInclude(plain, { kind: 'plain', handed: null, reviewing: null })
      assert.strictEqual((yield* cardOnce(change.taskId, (card) => card.phase === 'ready')).kind, 'change')
      // Its plan ends in a pull request: a change before it has done anything.
      assert.deepInclude(yield* queries.card(later.taskId), { phase: 'planned', kind: 'change' })

      // Finished, it waits on its board, and nothing else counts it as waiting on the person.
      const board = yield* queries.board(project.projectId)
      assert.deepStrictEqual(
        board.tasks.filter((task) => task.phase === 'ready').map((task) => [task.title, task.kind]),
        [
          ['Which partners still call v1?', 'plain'],
          ['Retry the checkout', 'change'],
        ],
      )
      const home = yield* queries.home()
      assert.deepStrictEqual(
        home.tasks.map((task) => task.title),
        ['Retry the checkout'],
      )
      const summary = (yield* queries.projects).projects.find((one) => one.id === project.projectId)
      assert.strictEqual(summary?.ready, 1)
      assert.deepStrictEqual([...(yield* queries.finished)], [question.taskId])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('becomes a change as a plain task writes, and a change at work shows how big its branch is so far', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const looking = yield* planned(project.projectId, 'Look around', '[lead:wait]')
      const card = yield* cardOnce(looking.taskId, (one) => one.phase === 'running')
      assert.strictEqual(card.kind, 'plain')
      assert.isNull((yield* queries.board(project.projectId)).tasks.find((task) => task.taskId === looking.taskId)?.changed)
      // Its lead writes a file in its worktree: it is a change now, its size read from git.
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
      const question = yield* planned(project.projectId, 'Prototype the empty state', '[lead:finish]')
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

describe('seeing a task', () => {
  it.live('settles a plain task that finished as done, and only that; writing to its lead opens it again', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const question = yield* planned(project.projectId, 'Which partners still call v1?', '[lead:finish]')
      const change = yield* planned(project.projectId, 'Retry the checkout', '[lead:finish] [lead:edit]')
      const working = yield* planned(project.projectId, 'Hold the line', '[lead:wait]')
      yield* cardOnce(question.taskId, (card) => card.phase === 'ready')
      yield* cardOnce(change.taskId, (card) => card.phase === 'ready')
      yield* cardOnce(working.taskId, (card) => card.phase === 'running')
      // What the window does as a task's screen opens.
      const see = (taskId: string) =>
        Effect.gen(function* () {
          const card = yield* queries.card(taskId)
          yield* tasks.see({ taskId, finished: card.kind === 'plain' && card.phase === 'ready' })
        })

      // A change ready to accept, and a task at work, are only marked seen.
      yield* see(change.taskId)
      yield* see(working.taskId)
      for (const taskId of [change.taskId, working.taskId]) {
        const seen = yield* row(taskId)
        assert.deepInclude(seen, { state: 'open', settledAt: null })
        assert.isNotNull(seen.seenAt)
      }
      // Told it finished while it hadn't, nothing settles: what is written is read again.
      yield* tasks.see({ taskId: working.taskId, finished: true })
      assert.strictEqual((yield* row(working.taskId)).state, 'open')

      // The plain task that finished is done once seen, recorded as any task done is.
      yield* see(question.taskId)
      const done = yield* row(question.taskId)
      assert.strictEqual(done.state, 'done')
      assert.strictEqual(done.settledAt, done.seenAt)
      assert.deepInclude(yield* queries.card(question.taskId), { phase: 'settled', kind: 'plain' })
      const [recorded] = yield* sql<{ payload: string }>`
        SELECT payload FROM record_events WHERE aggregate_id = ${question.taskId} AND type = 'task.done'`
      assert.deepStrictEqual(JSON.parse(recorded?.payload ?? '{}'), { seen: true })
      // Seen again, nothing more happens.
      yield* see(question.taskId)
      assert.strictEqual((yield* row(question.taskId)).settledAt, done.settledAt)

      // The person writes to its lead: it goes back to work as a follow-up, and, having made nothing, is done again.
      const sessions = yield* Sessions
      const body = 'And the v2 ones? [lead:slowly]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: question.threadId, body }),
        threadId: question.threadId,
        body,
      })
      yield* until(
        Effect.map(row(question.taskId), (task) => [task]),
        ([task]) => task?.state === 'open',
        Duration.seconds(20),
      )
      yield* until(
        Effect.map(row(question.taskId), (task) => [task]),
        ([task]) => task?.state === 'done',
        Duration.seconds(30),
      )
      assert.strictEqual((yield* row(question.taskId)).settledAt, done.settledAt)
      yield* sessions.stop(working.threadId)
    }).pipe(Effect.provide(withQueries())),
  )
})
