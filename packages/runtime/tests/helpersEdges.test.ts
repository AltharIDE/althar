import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Helpers } from '../src/Helpers'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, repository, runtime, until } from './support'

/*
 * The edges of a lead's helpers (ADR-087): what start_helper refuses, and
 * why; a writing helper that changes nothing, or leaves its work
 * uncommitted; a result that wakes a lead that stopped, or says nothing;
 * one stopped by the person, said in the thread; and one that
 * can't go on, as its agent won't start, is out of usage, goes before it is
 * done, or can't start again after a restart, its lead hearing at once and
 * woken where it had stopped.
 */

const runtimeWith = (github: FakeService, each?: Readonly<Record<string, FakeAgentOptions>>, file = ':memory:') =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        file,
        {},
        { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1), ...(each === undefined ? {} : { each }) },
      ),
    ),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const access: ToolAccess = {
      role: 'lead',
      projectId: project.projectId,
      threadId: card.threadId,
      sessionId: lead?.id ?? '',
      taskId: card.taskId,
    }
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', access }
  })

const helperOf = (taskId: string, name: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ id: string; state: string; result: string | null; threadId: string; keptRef: string | null }>`
      SELECT id, state, result, thread_id, kept_ref FROM helpers WHERE task_id = ${taskId} AND name = ${name}`,
  )

/** Until the task's helper of that name is in that state. */
const helperIn = (taskId: string, name: string, state: string) =>
  Effect.map(
    until(helperOf(taskId, name), (rows) => rows[0]?.state === state),
    (rows) => rows[0] ?? assert.fail('no helper'),
  )

/** Until the lead is told something starting so: what it was told. */
const leadHears = (threadId: string, starts: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [heard] = yield* until(
      sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND substr(body, 1, ${starts.length}) = ${starts}`,
      (rows) => rows.length === 1,
    )
    return heard?.body ?? ''
  })

/** The lead's session stopped, as between its turns once the person leaves it. */
const leadStopped = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.stop(threadId)
    yield* until(sessions.running(threadId), Option.isNone)
  })

const start = (task: { readonly taskId: string }, more: Partial<Parameters<Helpers['Service']['start']>[0]>) =>
  Effect.flatMap(Helpers, (helpers) =>
    helpers.start({
      taskId: task.taskId,
      name: 'Helper',
      brief: 'Look at the retry.',
      agentId: 'claude-code',
      model: null,
      modelName: 'Fake model',
      ...more,
    }),
  )

describe('starting a lead’s helper', () => {
  it.live('refuses one with no brief, on a change the task doesn’t have, beside one at work there, or with no copy to work in', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      assert.strictEqual(
        yield* callTool(task.access, 'start_helper', { name: 'Idle', brief: '  ' }),
        'Give the helper its brief: what to do, whole. It reads nothing of your conversation.',
      )
      assert.strictEqual(
        yield* callTool(task.access, 'start_helper', { name: 'Lost', brief: 'Look.', change: 'Nowhere' }),
        'This task has no change "Nowhere" here: start_change starts one.',
      )
      // Unnamed, it is a helper; it works until it is stopped.
      assert.match(
        yield* callTool(task.access, 'start_helper', { name: ' ', brief: 'Look around. [lead:explore]' }),
        /^Started "Helper" on .+, in the worktree of the task’s change\./,
      )
      assert.strictEqual(
        yield* callTool(task.access, 'start_helper', { name: 'Second', brief: 'More.' }),
        'Helper "Helper" works on the task’s change already: hand this one another change, or wait for it.',
      )
      // Another change, named in any case, takes one of its own.
      yield* callTool(task.access, 'start_change', { name: 'Docs' })
      assert.match(
        yield* callTool(task.access, 'start_helper', { name: 'On docs', brief: 'Look. [lead:explore]', change: 'docs' }),
        /^Started "On docs" on .+, in the worktree of “Docs”\./,
      )
      // A change whose folder went has nothing to copy.
      yield* callTool(task.access, 'start_change', { name: 'Gone' })
      const sql = yield* SqlClient.SqlClient
      const [gone] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId} AND name = 'Gone'`
      git(working, 'worktree', 'remove', '--force', gone?.path ?? '')
      assert.strictEqual(
        yield* callTool(task.access, 'start_helper', { name: 'Copy', brief: 'Look.', change: 'Gone', in_copy: true }),
        "Althar couldn't make a copy of “Gone” for the helper. Try again, or hand it the change itself.",
      )
      assert.lengthOf(yield* helperOf(task.taskId, 'Copy'), 0)
      // The task's first change dropped, there is no worktree to hand one without a change named.
      yield* callTool(task.access, 'stop_helper', { helper: 'Helper' })
      yield* callTool(task.access, 'remove_part', { part: 'workspace', name: 'althar/add-a-retry', why: 'Done with it.' })
      assert.strictEqual(
        yield* callTool(task.access, 'start_helper', { name: 'First', brief: 'Look.' }),
        'This task has no worktree to hand a helper: take one with add_part first.',
      )
      // A task that never ran has nothing to hand one.
      const projects = yield* Projects
      const later = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Later' }),
        projectId: task.projectId,
        title: 'Later',
      })
      assert.strictEqual(
        yield* start({ taskId: later.taskId }, { name: 'Early' }),
        'This task has never run, so it has nothing to hand a helper yet.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('refuses one past how many may be at work or waiting, and past a task’s life', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // A helper in a project of its own, failed as a restart leaves one: it counts for nothing here.
      const projects = yield* Projects
      const aside = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const early = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Aside' }),
        projectId: aside.projectId,
        title: 'Aside',
      })
      const failedAt = new Date().toISOString()
      yield* sql`INSERT INTO helpers ${sql.insert({
        id: 'hlp_aside',
        taskId: early.taskId,
        projectId: aside.projectId,
        threadId: 'thr_aside',
        name: 'Aside',
        brief: 'Read it.',
        agentId: 'claude-code',
        state: 'failed',
        result: 'Althar restarted, and its agent couldn’t start again.',
        startedAt: failedAt,
        endedAt: failedAt,
      })}`
      const task = yield* opened(working)
      const at = new Date().toISOString()
      const kept = (n: number, state: string) =>
        Effect.forEach(
          Array.from({ length: n }, (_, index) => index),
          (index) =>
            sql`INSERT INTO helpers ${sql.insert({
              id: `hlp_${state}${index}`,
              taskId: task.taskId,
              projectId: task.projectId,
              threadId: `thr_${state}${index}`,
              name: `Helper ${index}`,
              brief: 'Read it.',
              agentId: 'claude-code',
              state,
              startedAt: at,
            })}`,
        )
      // Ten at work or waiting for a place: no eleventh, and the lead hears which they are.
      yield* kept(10, 'working')
      const full = yield* start(task, { name: 'Eleventh' })
      yield* sql`UPDATE helpers SET state = 'done', ended_at = ${at} WHERE task_id = ${task.taskId}`
      assert.match(
        full,
        /^10 helpers are at work or waiting for a place already \("Helper 0", "Helper 1", .*"Helper 9"\): wait for a result/,
      )
      // Fifty in its life, and it has had them all.
      yield* kept(40, 'stopped')
      assert.strictEqual(
        yield* start(task, { name: 'Fifty-first' }),
        'This task has had 50 helpers, its most: do the rest yourself, or tell the person.',
      )
      assert.lengthOf(yield* helperOf(task.taskId, 'Fifty-first'), 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('starts one on the model and effort it is given, and fails one whose agent won’t start', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      assert.match(
        yield* start(task, { name: 'Strong', model: 'large', effort: 'high', inCopy: true }),
        /^Started "Strong" on Fake model, in a copy of its own/,
      )
      const strong = yield* helperIn(task.taskId, 'Strong', 'done')
      const [session] = yield* sql<{ model: string | null; effort: string | null }>`
        SELECT model, effort FROM provider_sessions WHERE thread_id = ${strong.threadId} ORDER BY started_at LIMIT 1`
      assert.deepStrictEqual([session?.model, session?.effort], ['large', 'high'])
      assert.strictEqual(
        yield* start(task, { name: 'Nowhere', agentId: 'missing', modelName: 'Missing' }),
        'Helper "Nowhere" couldn\'t start on Missing: its agent didn\'t start. Start it again on another model, as you judge.',
      )
      const missing = yield* helperIn(task.taskId, 'Nowhere', 'failed')
      assert.strictEqual(missing.result, 'Its agent couldn’t start.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a writing helper’s work', () => {
  it.live('is no commit where it changed nothing, and is committed for it where it left it uncommitted', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.access, 'start_helper', { name: 'Reader', brief: 'Read the retry.', writes: true })
      const reader = yield* helperIn(task.taskId, 'Reader', 'done')
      assert.isNull(reader.keptRef)
      assert.notInclude(reader.result ?? '', 'Its work is kept as commit')
      yield* callTool(task.access, 'start_helper', { name: 'Drafter', brief: 'Draft the notes. [lead:write]', writes: true })
      const drafter = yield* helperIn(task.taskId, 'Drafter', 'done')
      assert.isNotNull(drafter.keptRef)
      assert.strictEqual(git(task.path, 'log', '-1', '--format=%s', drafter.keptRef ?? ''), 'Helper “Drafter”')
      assert.strictEqual(git(task.path, 'show', '--format=', '--name-only', drafter.keptRef ?? ''), 'draft.md')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('stopping a lead’s helper', () => {
  it.live('says there is none of that name, and, stopped by the person, says so in the lead’s thread', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      assert.strictEqual(yield* callTool(task.access, 'stop_helper', { helper: 'Nobody' }), 'No helper "Nobody" is at work on this task.')
      yield* callTool(task.access, 'start_helper', { name: 'Explorer', brief: 'Look around. [lead:explore]' })
      const explorer = yield* helperIn(task.taskId, 'Explorer', 'working')
      // Its turn interrupted, it is still at work: the person stops it.
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(explorer.threadId)),
        (busy) => busy,
      )
      yield* (yield* Sessions).interrupt(explorer.threadId)
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(explorer.threadId)),
        (busy) => !busy,
      )
      assert.strictEqual(
        yield* (yield* Helpers).stop({ taskId: task.taskId, helper: 'explorer', by: 'person' }),
        'Stopped "Explorer". Nothing of it comes back.',
      )
      yield* helperIn(task.taskId, 'Explorer', 'stopped')
      const said = (yield* items(task.threadId)).flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : []))
      assert.include(said, 'You stopped helper “Explorer”: what it had said stays on its thread.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a helper’s result', () => {
  it.live('wakes a lead that stopped, to hear it as a new turn', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* leadStopped(task.threadId)
      const before = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`)[0]?.n ?? 0
      yield* start(task, { name: 'Reader', inCopy: true })
      yield* helperIn(task.taskId, 'Reader', 'done')
      yield* leadHears(task.threadId, 'Helper "Reader" (claude-code) ended.')
      yield* until(
        sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`,
        (rows) => (rows[0]?.n ?? 0) > before,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('says it said nothing, where its turn ends without a word', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      // Its model declines, saying nothing.
      yield* start(task, { name: 'Silent', brief: 'Look. [lead:refuse]', inCopy: true })
      const silent = yield* helperIn(task.taskId, 'Silent', 'done')
      assert.strictEqual(silent.result, '(It said nothing.)')
      const heard = yield* leadHears(task.threadId, 'Helper "Silent" (claude-code) ended.')
      assert.include(heard, "What it said, which is its own and not the person's:\n\n(It said nothing.)")
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a helper that can’t go on', () => {
  it.live('out of usage, is failed at once, and its lead, stopped, is woken to hear it', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* leadStopped(task.threadId)
      const before = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`)[0]?.n ?? 0
      yield* start(task, { name: 'Spent', agentId: 'codex', modelName: 'Codex', inCopy: true })
      const spent = yield* helperIn(task.taskId, 'Spent', 'failed')
      assert.strictEqual(spent.result, 'codex is out of usage.')
      const heard = yield* leadHears(task.threadId, 'Helper "Spent" (codex) couldn\'t go on: codex is out of usage.')
      assert.match(heard, /The models you can use now: |No model can be used now\./)
      yield* until(
        sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`,
        (rows) => (rows[0]?.n ?? 0) > before,
      )
    }).pipe(Effect.provide(runtimeWith(github, { codex: { outOfUsage: {} } })))
  })

  it.live('whose agent goes before it is done, is failed, and its lead hears to start it again', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* start(task, { name: 'Crashes', brief: 'Look at the retry. [lead:gone-once]', inCopy: true })
      const crashed = yield* helperIn(task.taskId, 'Crashes', 'failed')
      assert.strictEqual(crashed.result, 'Its agent stopped before it was done.')
      yield* leadHears(
        task.threadId,
        'Helper "Crashes" (claude-code) stopped before it was done: its agent went. Start it again, on this or another model, as you judge.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('after a restart, where its agent can’t start again, is failed, and its lead hears', () => {
    const { working, github } = onGitHub()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-helpers-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const task = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const task = yield* opened(working)
        // At work, as far as Althar kept it, with no session of its own to start again.
        yield* sql`INSERT INTO helpers ${sql.insert({
          id: 'hlp_orphan',
          taskId: task.taskId,
          projectId: task.projectId,
          threadId: 'thr_orphan',
          name: 'Orphan',
          brief: 'Read it.',
          agentId: 'claude-code',
          state: 'working',
          startedAt: new Date().toISOString(),
        })}`
        return task
      }).pipe(Effect.provide(runtimeWith(github, undefined, file)))
      yield* Effect.gen(function* () {
        const orphan = yield* helperIn(task.taskId, 'Orphan', 'failed')
        assert.strictEqual(orphan.result, 'Althar restarted, and its agent couldn’t start again.')
        yield* leadHears(
          task.threadId,
          'Helper "Orphan" (claude-code) couldn\'t go on: Althar restarted, and its agent couldn’t start again.',
        )
      }).pipe(Effect.provide(runtimeWith(github, undefined, file)))
    })
  })

  it.live('one that started after Althar did is not a restart’s to carry on', () => {
    const { working, github } = onGitHub()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-helpers-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const task = yield* opened(working).pipe(Effect.provide(runtimeWith(github, undefined, file)))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // A second Althar starts: a helper's row is in before its session is, as one started just then.
        yield* sql`INSERT INTO helpers ${sql.insert({
          id: 'hlp_starting',
          taskId: task.taskId,
          projectId: task.projectId,
          threadId: 'thr_starting',
          name: 'Starting',
          brief: 'Read it.',
          agentId: 'claude-code',
          state: 'working',
          startedAt: new Date().toISOString(),
        })}`
        // Past the moment a restart's helpers are carried on: at work still, not failed for a restart it wasn't in.
        yield* Effect.sleep(Duration.seconds(3))
        const [helper] = yield* helperOf(task.taskId, 'Starting')
        assert.strictEqual(helper?.state, 'working')
      }).pipe(Effect.provide(runtimeWith(github, undefined, file)))
    })
  })
})
