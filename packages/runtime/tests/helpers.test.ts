import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Busy } from '../src/Busy'
import { Coordinator } from '../src/Coordinator'
import { Helpers } from '../src/Helpers'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, launches, runtime, until } from './support'

/*
 * A lead's helpers (ADR-087, as "a task is a conversation plus parts" amends
 * it): handed one of the task's changes, a helper works in its worktree in
 * the background, on a session of its own, and its last message comes back
 * to the lead as a new turn; the lead's report waits for it, and a helper
 * ships, asks and starts nothing.
 */

const runtimeWith = (github: FakeService, pauses?: ReadonlyArray<Duration.Duration>) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        {
          connectors: fakeConnectors({ github }),
          listenEvery: Duration.hours(1),
          ...(pauses === undefined ? {} : { connectivity: { pauses } }),
        },
      ),
    ),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

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

describe('a lead’s helpers', () => {
  it.live('work on a change in the background, in its worktree, and their result comes to the lead as a new turn', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const before = git(task.path, 'rev-parse', 'HEAD')
      const said = yield* callTool(task.access, 'start_helper', {
        name: 'Note the retry',
        brief: 'Write a note on how the retry works, and commit it. [lead:commit]',
      })
      assert.match(said, /^Started "Note the retry" on .+, in the worktree of the task’s change\. Its result comes to you as a new turn/)
      // The thread says what started, where.
      assert.isTrue(
        (yield* items(task.threadId)).some(
          (item) => item.kind === 'notice' && String(item.content.title).startsWith('Helper · Note the retry'),
        ),
      )
      // Its result: kept, its session ended, and queued to the lead as news, which it reads as a new turn.
      const [done] = yield* until(
        sql<{ state: string; result: string | null; threadId: string; id: string }>`
          SELECT state, result, thread_id, id FROM helpers WHERE task_id = ${task.taskId}`,
        (rows) => rows[0]?.state === 'done',
      )
      assert.isNotNull(done?.result ?? null)
      const told = yield* until(
        sql<{ body: string }>`
          SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'Helper "Note the retry"%'`,
        (rows) => rows.length === 1,
      )
      assert.include(told[0]?.body ?? '', "What it said, which is its own and not the person's:")
      assert.isTrue(existsSync(`${task.path}/.althar/scratch/helpers/${done?.id ?? ''}.md`))
      // Its commits are on the change's branch: nothing needs bringing back.
      yield* until(
        Effect.sync(() => git(task.path, 'rev-parse', 'HEAD')),
        (now) => now !== before,
      )
      // A helper ships, asks and starts nothing.
      const helper: ToolAccess = { ...task.access, threadId: done?.threadId ?? '', sessionId: 'none' }
      assert.include(yield* callTool(helper, 'start_helper', { name: 'Again', brief: 'More.' }), 'You are a helper')
      assert.include(yield* callTool(helper, 'push_to_pull_request', {}), 'You are a helper')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keep the lead’s report waiting while one is at work, and stop on its word', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      // One at work, as its session would have it.
      const [run] = yield* sql<{ executionId: string }>`
        SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id WHERE r.task_id = ${task.taskId} LIMIT 1`
      const at = new Date().toISOString()
      yield* sql`INSERT INTO threads ${sql.insert({ id: 'th_helper0000000000000000000000000000', projectId: task.projectId, kind: 'step', taskId: task.taskId, executionId: run?.executionId ?? '', nodeKey: 'helper:x', createdAt: at })}`.pipe(
        Effect.catch(() => Effect.void),
      )
      const [threadRow] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE node_key = 'helper:x'`
      yield* sql`INSERT INTO helpers ${sql.insert({ id: 'hlp_x', taskId: task.taskId, projectId: task.projectId, threadId: threadRow?.id ?? 'none', name: 'Split it', brief: 'Split.', agentId: 'claude-code', state: 'working', startedAt: at })}`
      assert.include(yield* callTool(task.access, 'finish_step', { summary: 'Done.' }), 'Your helpers are still at work: "Split it"')
      // Stopped by its lead: nothing of it comes back.
      assert.include(yield* callTool(task.access, 'stop_helper', { helper: 'Split it' }), 'Stopped "Split it"')
      const [stopped] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE id = 'hlp_x'`
      assert.strictEqual(stopped?.state, 'stopped')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('are stopped once past their hour, and the lead hears, with the models it can use', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const [run] = yield* sql<{ executionId: string }>`
        SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id WHERE r.task_id = ${task.taskId} LIMIT 1`
      const long = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      yield* sql`INSERT INTO threads ${sql.insert({ id: 'thr_11111111111111111111111111111111', projectId: task.projectId, kind: 'step', taskId: task.taskId, executionId: run?.executionId ?? '', nodeKey: 'helper:late', createdAt: long })}`
      yield* sql`INSERT INTO helpers ${sql.insert({ id: 'hlp_late', taskId: task.taskId, projectId: task.projectId, threadId: 'thr_11111111111111111111111111111111', name: 'Slow one', brief: 'Read it all.', agentId: 'claude-code', state: 'working', startedAt: long })}`
      yield* (yield* Helpers).lookAtHours
      const [late] = yield* sql<{ state: string; result: string | null }>`SELECT state, result FROM helpers WHERE id = 'hlp_late'`
      assert.strictEqual(late?.state, 'failed')
      assert.include(late?.result ?? '', 'worked for its hour')
      const [told] = yield* until(
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'Helper "Slow one"%'`,
        (rows) => rows.length === 1,
      )
      assert.include(told?.body ?? '', "couldn't go on: it worked for its hour")
      assert.match(told?.body ?? '', /The models you can use now: |No model can be used now\./)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('try a failing service again after each pause, then tell the lead it couldn’t go on', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* callTool(task.access, 'start_helper', { name: 'Busy service', brief: 'Look at the retry. [overloaded]' })
      const [failed] = yield* until(
        sql<{ state: string; result: string | null; threadId: string }>`
          SELECT state, result, thread_id FROM helpers WHERE task_id = ${task.taskId}`,
        (rows) => rows[0]?.state === 'failed',
      )
      assert.include(failed?.result ?? '', 'kept failing')
      assert.include(failed?.result ?? '', 'tried 4 times')
      // Each try again said on its thread.
      const tries = (yield* items(failed?.threadId ?? '')).filter(
        (item) => item.kind === 'notice' && String(item.content.title).startsWith('Its service didn’t answer: trying again'),
      )
      assert.lengthOf(tries, 3)
      yield* until(
        sql<{
          body: string
        }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'Helper "Busy service"%couldn''t go on%'`,
        (rows) => rows.length === 1,
      )
    }).pipe(Effect.provide(runtimeWith(github, [Duration.millis(20), Duration.millis(20), Duration.millis(20)])))
  })

  it.live('take a place of their own among the agents at work, apart from their lead’s', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* callTool(task.access, 'start_helper', { name: 'Takes a while', brief: 'Look around slowly. [lead:slowly]' })
      const [helper] = yield* until(
        sql<{ threadId: string }>`SELECT thread_id FROM helpers WHERE task_id = ${task.taskId}`,
        (rows) => rows.length === 1,
      )
      const now = yield* until((yield* Busy).now, (at) => at.holders.some((holder) => holder.helper === helper?.threadId))
      const its = now.holders.find((holder) => holder.helper === helper?.threadId)
      assert.strictEqual(its?.taskId, task.taskId)
      assert.isNotTrue(its?.review)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('carry on after a restart, told so on their thread', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const file = join(mkdtempSync(join(tmpdir(), 'althar-helpers-')), 'althar.sqlite')
    const launch = () =>
      Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })))
    return Effect.gen(function* () {
      const threadId = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const task = yield* opened(working)
        yield* callTool(task.access, 'start_helper', { name: 'Slow', brief: 'Look around slowly. [lead:slowly]' })
        const [row] = yield* until(sql<{ threadId: string }>`SELECT thread_id FROM helpers`, (rows) => rows.length === 1)
        yield* until(
          Effect.flatMap(Sessions, (sessions) => sessions.busy(row?.threadId ?? '')),
          (busy) => busy,
        )
        return row?.threadId ?? ''
      }).pipe(Effect.provide(launch()))
      // Althar starts again: the helper, still at work, carries on, told why.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* until(
          sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Althar restarted%'`,
          (rows) => rows.length === 1,
        )
        const [still] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE thread_id = ${threadId}`
        assert.notStrictEqual(still?.state, 'failed')
      }).pipe(Effect.provide(launch()))
    })
  })

  it.live('given no change, work in a copy of their own: thrown away, or kept as a commit the lead brings in', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const before = git(task.path, 'rev-parse', 'HEAD')
      const done = (name: string) =>
        until(
          sql<{ id: string; state: string; result: string | null; copyPath: string | null; keptRef: string | null }>`
            SELECT id, state, result, copy_path, kept_ref FROM helpers WHERE task_id = ${task.taskId} AND name = ${name}`,
          (rows) => rows[0]?.state === 'done',
        ).pipe(Effect.map((rows) => rows[0] ?? assert.fail('no helper')))

      // In a copy, what it changes is thrown away with the copy.
      assert.match(
        yield* callTool(task.access, 'start_helper', { name: 'Try it', brief: 'Try a note. [lead:commit]', in_copy: true }),
        /in a copy of its own of the task’s change as it stands now: what it changes there is thrown away/,
      )
      const tried = yield* done('Try it')
      assert.isNotNull(tried.copyPath)
      assert.isFalse(existsSync(tried.copyPath ?? ''))
      assert.isNull(tried.keptRef)
      assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), before)

      // Writing, its work is kept as a commit on a ref of its own, never pushed, which the lead brings in.
      yield* callTool(task.access, 'start_helper', { name: 'Write it', brief: 'Write a note. [lead:commit]', writes: true })
      const wrote = yield* done('Write it')
      assert.strictEqual(wrote.keptRef, `refs/althar/helpers/${task.taskId}/${wrote.id}`)
      assert.include(wrote.result ?? '', 'Its work is kept as commit')
      assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), before)
      const range = /git cherry-pick --no-commit ([0-9a-f]+\.\.[0-9a-f]+)/.exec(wrote.result ?? '')?.[1] ?? assert.fail('no range')
      git(task.path, 'cherry-pick', '--no-commit', range)
      assert.isTrue(existsSync(join(task.path, 'change.txt')))
      assert.isFalse(existsSync(wrote.copyPath ?? ''))
      assert.throws(() => git(bare, 'rev-parse', '--verify', wrote.keptRef ?? ''))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('work on every agent the tests run, each one’s result coming to the lead, and one in a copy never in the lead’s folder', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      for (const agent of ['claude-code', 'codex', 'opencode']) {
        const name = `On ${agent}`
        yield* callTool(task.access, 'start_helper', { name, agent, brief: 'Look at the retry, and say what you found.', in_copy: true })
        const [done] = yield* until(
          sql<{ state: string; threadId: string; copyPath: string | null }>`
            SELECT state, thread_id, copy_path FROM helpers WHERE task_id = ${task.taskId} AND name = ${name}`,
          (rows) => rows[0]?.state === 'done',
        )
        // On that agent, launched in its copy, never in its lead's folder.
        const [session] = yield* sql<{ agentId: string }>`
          SELECT agent_id FROM provider_sessions WHERE thread_id = ${done?.threadId ?? ''} ORDER BY started_at LIMIT 1`
        assert.strictEqual(session?.agentId, agent)
        const launched = launches.filter((one) => one.agentId === agent && one.cwd.includes('/.helpers/'))
        assert.isNotEmpty(launched)
        assert.isTrue(launched.every((one) => !one.cwd.startsWith(`${task.path}/`) && one.cwd !== task.path))
        // Its result comes to the lead as news.
        yield* until(
          sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE ${`Helper "${name}"%`}`,
          (rows) => rows.length === 1,
        )
      }
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
