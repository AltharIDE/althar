import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries, stuckOf } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { askToFix, codexHomeOf } from '../src/startCause'
import { items, repository, runtime, until } from './support'

/*
 * A step whose agent fails for a reason on this computer (DEV-285), as every
 * Codex task in ai-teacher did: `.codex` at the repository's root was a file,
 * Codex's stream said only that it retried and then "Codex encountered an
 * internal error", and its own log said `failed to load workspace
 * requirements: not a directory`. The step stops at once with that reason,
 * never backing off as for OpenAI; another task meeting it waits on the first
 * one's card, said once; the coordinator is asked from the card; and once the
 * file is gone, both go on by themselves.
 */

/** The fake Codex fails as in ai-teacher while `state.local` is set; its log goes to a `CODEX_HOME` of the test's own. */
const setUp = () => {
  const state: { local: boolean; server: boolean; answers: boolean } = { local: true, server: false, answers: true }
  process.env['CODEX_HOME'] = mkdtempSync(join(tmpdir(), 'althar-codex-home-'))
  const layer = Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        { connection: () => (state.local ? 'local' : state.server ? 'server' : undefined) },
        {
          connectivity: {
            answers: () => Effect.sync(() => state.answers),
            pauses: [Duration.millis(30), Duration.millis(60), Duration.millis(90)],
            every: Duration.millis(50),
          },
        },
      ),
    ),
  )
  return { state, layer }
}

/** A project whose checkout has a file named `.codex` at its root, where Codex reads a folder. */
const strayProject = () => {
  const path = repository()
  writeFileSync(join(path, '.codex'), 'left here by something else\n')
  return path
}

/** A project whose repository tracks a file named `.codex`: every task's worktree holds its own copy. */
const trackedStray = () => {
  const path = repository()
  writeFileSync(join(path, '.codex'), 'committed by mistake\n')
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: path })
  git('add', '.codex')
  git('commit', '-q', '-m', 'Add .codex')
  return path
}

/** A Codex task planned on its lead alone, started now. */
const planned = (path: string, title: string) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      description: 'Fix the heading. [lead:finish]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return { projectId: project.projectId, ...task }
  })

const implementOf = (taskId: string, stands: (attempt: { state: string; holdReason: string | null; output: string | null }) => boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [attempt] = yield* until(
      sql<{ state: string; holdReason: string | null; output: string | null }>`
        SELECT a.state, a.hold_reason, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
        JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
        WHERE r.task_id = ${taskId} AND n.node_key = 'implement' ORDER BY a.admitted_at DESC LIMIT 1`,
      (rows) => rows[0] !== undefined && stands(rows[0]),
    )
    return attempt ?? { state: '', holdReason: null, output: null }
  })

const openCalls = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; payload: string }>`
      SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [(item.content as { title: string }).title] : [])))

/** Held after its next turn failed, rather than still waiting on the cause. */
const turnsSettled = (attempt: { output?: string | null }) =>
  (JSON.parse(attempt.output ?? '{}') as { local?: unknown }).local === undefined

/** The agent sessions a thread had. */
const sessionsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ id: string }>`SELECT external_session_id AS id FROM provider_sessions WHERE thread_id = ${threadId}`).map(
      (row) => row.id,
    )
  })

const turnsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

describe('a step whose agent fails for a reason on this computer', () => {
  it.live('stops at once, naming the file in the way, rather than backing off as for OpenAI (ai-teacher)', () => {
    const { layer } = setUp()
    const path = strayProject()
    return Effect.gen(function* () {
      const task = yield* planned(path, 'Retry the checkout')
      const [call] = yield* until(openCalls(task.taskId), (calls) => calls.length > 0)
      const info = JSON.parse(call?.payload ?? '{}') as { why: string; detail: string; cause: { path: string } }
      assert.strictEqual(info.why, 'local_cause')
      assert.match(info.detail, /^`[^`]*\.codex` is a file, not a folder\.$/)
      assert.match(info.cause.path, /\.codex$/)
      // Never held to back off for the provider: one turn, and the step needs the person.
      const attempt = yield* implementOf(task.taskId, (one) => one.state !== 'running')
      assert.notStrictEqual(attempt.holdReason, 'agent_unavailable')
      assert.lengthOf(yield* turnsOf(task.threadId), 1)
      // The window's call says it in those words, with the path.
      const stuck = stuckOf(JSON.parse(call?.payload ?? '{}'))
      assert.strictEqual(stuck.why, 'local_cause')
      assert.match(stuck.cause?.path ?? '', /\.codex$/)
      // Said once for the project, in the coordinator's thread.
      const home = yield* (yield* Coordinator).thread(task.projectId as ProjectId)
      const said = (yield* notices(home)).filter((title) => /codex can't start: /i.test(title))
      assert.lengthOf(said, 1)
      assert.match(said[0] ?? '', /\.codex` is a file, not a folder\.$/)
    }).pipe(Effect.provide(layer))
  })

  it.live('says it once for the project: another task waits on the first card, and both go on once the file is gone', () => {
    const { state, layer } = setUp()
    const path = strayProject()
    return Effect.gen(function* () {
      const first = yield* planned(path, 'Retry the checkout')
      yield* until(openCalls(first.taskId), (calls) => calls.length > 0)
      const second = yield* planned(path, 'Tidy the header')
      const held = yield* implementOf(second.taskId, (one) => one.state === 'held')
      assert.strictEqual(held.holdReason, 'agent_unavailable')
      assert.match((JSON.parse(held.output ?? '{}') as { local: { words: string } }).local.words, /\.codex` is a file, not a folder\./)
      assert.lengthOf(yield* openCalls(second.taskId), 0)
      const home = yield* (yield* Coordinator).thread(first.projectId as ProjectId)
      assert.lengthOf(
        (yield* notices(home)).filter((title) => /codex can't start: /i.test(title)),
        1,
      )
      // The file goes, and a folder takes its place: Codex works again, and both steps carry on with no one pressing anything.
      // Codex works again as the file goes: it fails for nothing else.
      state.local = false
      rmSync(join(path, '.codex'))
      mkdirSync(join(path, '.codex'))
      yield* implementOf(first.taskId, (one) => one.state === 'succeeded')
      yield* implementOf(second.taskId, (one) => one.state === 'succeeded')
      assert.lengthOf(yield* openCalls(first.taskId), 0)
    }).pipe(Effect.provide(layer))
  })

  it.live('asks the coordinator from the card, with the cause, the checkout and how to go on in its news', () => {
    const { layer } = setUp()
    const path = strayProject()
    return Effect.gen(function* () {
      const task = yield* planned(path, 'Retry the checkout')
      const [call] = yield* until(openCalls(task.taskId), (calls) => calls.length > 0)
      const asked = yield* askToFix(call?.id ?? '', yield* Runtime.envelope('attention.fix_with_coordinator', {}))
      assert.isDefined(asked)
      assert.include(asked?.body ?? '', "can't start on")
      assert.match(asked?.body ?? '', /\.codex` is a file, not a folder\./)
      assert.include(asked?.body ?? '', 'ask the person first')
      assert.include(asked?.body ?? '', 'plan a small fix task')
      assert.include(asked?.body ?? '', 'answer_stuck_step')
      // The card says it was asked, and stays open meanwhile; the thread says so.
      const [still] = yield* openCalls(task.taskId)
      assert.isString((JSON.parse(still?.payload ?? '{}') as { cause: { askedAt?: string } }).cause.askedAt)
      assert.include(yield* notices(task.threadId), 'Asked the coordinator to fix it.')
      // A call that isn't there fails out loud, so the card offers it again.
      const missing = yield* Effect.flip(askToFix('att_missing', yield* Runtime.envelope('attention.fix_with_coordinator', {})))
      assert.strictEqual(missing._tag, 'NotFound')
    }).pipe(Effect.provide(layer))
  })

  it.live('says it once for a tracked file every worktree holds: the tasks share one card, keyed by its path in the repository', () => {
    const { layer } = setUp()
    const path = trackedStray()
    return Effect.gen(function* () {
      const first = yield* planned(path, 'Retry the checkout')
      const [call] = yield* until(openCalls(first.taskId), (calls) => calls.length > 0)
      // The file in the task's own worktree, not the checkout's.
      const cause = (JSON.parse(call?.payload ?? '{}') as { cause: { key: string; path: string } }).cause
      assert.strictEqual(cause.key, 'not_a_folder:.codex')
      const second = yield* planned(path, 'Tidy the header')
      const held = yield* implementOf(second.taskId, (one) => one.state === 'held')
      assert.strictEqual((JSON.parse(held.output ?? '{}') as { local: { key: string } }).local.key, 'not_a_folder:.codex')
      assert.lengthOf(yield* openCalls(second.taskId), 0)
      // The coordinator is told to fix it on an agent the file doesn't stop, and to bring main into the tasks after.
      const asked = yield* askToFix(call?.id ?? '', yield* Runtime.envelope('attention.fix_with_coordinator', {}))
      assert.include(asked.body, 'update_branch')
      assert.include(asked.body, 'not codex')
    }).pipe(Effect.provide(layer))
  })

  it.live(
    'still backs off for a provider that fails on a later turn of the same session, its log’s earlier local error put right since',
    () => {
      const { state, layer } = setUp()
      const path = strayProject()
      return Effect.gen(function* () {
        const first = yield* planned(path, 'Retry the checkout')
        yield* until(openCalls(first.taskId), (calls) => calls.length > 0)
        // The second waits on the first's card, in its own session, whose log now holds the local error.
        const second = yield* planned(path, 'Tidy the header')
        yield* implementOf(second.taskId, (one) => one.state === 'held')
        const sessions = yield* sessionsOf(second.threadId)
        // The file is put right, and OpenAI fails the next turn: the second carries on in the same session, and backs off.
        state.local = false
        state.server = true
        rmSync(join(path, '.codex'))
        mkdirSync(join(path, '.codex'))
        yield* until(turnsOf(second.threadId), (turns) => turns.length >= 2)
        // Backing off for OpenAI, or, its tries spent on a slow machine, stopped for OpenAI: never for the old local cause.
        yield* implementOf(second.taskId, (one) => (one.state === 'held' && turnsSettled(one)) || one.state === 'waiting_attention')
        assert.isTrue((yield* notices(second.threadId)).some((title) => title.startsWith('OpenAI failed. Trying again')))
        const calls = (yield* openCalls(second.taskId)).map((call) => (JSON.parse(call.payload) as { why: string }).why)
        assert.notInclude(calls, 'local_cause')
        assert.deepStrictEqual(yield* sessionsOf(second.threadId), sessions)
      }).pipe(Effect.provide(layer))
    },
  )
})

describe('the Codex home a cause is read from', () => {
  it.effect('is the account’s own, as its sessions run with it, else the usual one', () =>
    Effect.gen(function* () {
      const account = { id: 'acc_work', agentId: 'codex', name: 'Work', home: null, position: 1 } as never
      const homeOf = codexHomeOf({
        get: (id) => (id === 'acc_work' ? Effect.succeed(account) : Effect.fail('missing')),
        env: () => ({ CODEX_HOME: '/accounts/codex-work' }),
      })
      assert.strictEqual(yield* homeOf('acc_work'), '/accounts/codex-work')
      process.env['CODEX_HOME'] = '/usual/codex'
      assert.strictEqual(yield* homeOf(null), '/usual/codex')
      assert.strictEqual(yield* homeOf('acc_gone'), '/usual/codex')
    }),
  )
})
