import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Permissions } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { task, runtime, turns, until } from './support'

/*
 * Allow everything on one task (ADR-043), with the fake agent running real
 * commands: turned on, what waits on the person is decided again and goes
 * ahead, and so does what the task asks next, while the project's other
 * tasks still ask; what Althar can't read is refused rather than let
 * through while the project never allows something; and turned off, the
 * task asks again. A call a kind always asks about says it is held. A
 * burst, several calls waiting at once, clears whole: a task's by its
 * switch, and every task's in the project by the project's.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

const finished = (row: { readonly state: string }) => !['pending', 'delivered'].includes(row.state)

/** Waits until `count` turns that carried input have ended. */
const ended = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.filter((row) => row.inputs > 0 && finished(row)).length >= count)

/** A task with Codex working on it, its project's mode as given. */
const working = (mode: 'rules' | 'ask') =>
  Effect.gen(function* () {
    const policies = yield* Policies
    const instance = yield* Instance
    const sessions = yield* Sessions
    const made = yield* task()
    yield* policies.set(made.project.projectId, { permissions: mode }, instance.personId)
    yield* sessions.start({ threadId: made.task.threadId, agentId: 'codex' })
    yield* until(turns(made.task.threadId), (rows) => rows.length >= 1 && rows.every(finished))
    return made
  })

/** The calls open on a thread, as its screen reads them. */
const calls = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* queries.thread(threadId)).attention
  })

/** Waits for a call to open on a thread, and returns it. */
const waitingCall = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{ id: string }>`
        SELECT a.id FROM attention_requests a JOIN threads t ON t.task_id = a.task_id WHERE t.id = ${threadId} AND a.state = 'open'`,
      (rows) => rows.length > 0,
    )
    const [call] = yield* calls(threadId)
    if (call === undefined) return yield* Effect.die(new Error('no call'))
    return call
  })

/** Waits for `count` calls to open on a thread at once. */
const waitingCalls = (threadId: string, count: number) => until(calls(threadId), (open) => open.length >= count)

/** What the agent said, in order, leaving out the fake agent's echo of its brief. */
const said = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* queries.thread(threadId)).items.flatMap((item) =>
      item.kind === 'agent_message' && !item.content.text.startsWith('echo: ') ? [item.content.text] : [],
    )
  })

/** The person turns a task's allow everything on or off, from its menu. */
const allow = (taskId: string, on: boolean) =>
  Effect.gen(function* () {
    const permissions = yield* Permissions
    yield* permissions.allowEverything({
      envelope: yield* Runtime.envelope('task.set_allow_everything', { taskId, allowEverything: on }),
      taskId,
      on,
    })
  })

describe('allow everything on a task (ADR-043)', () => {
  it.live('lets through what waits and what the task asks next, while the project’s other tasks ask, and asks again once off', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const projects = yield* Projects
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* working('ask')
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Second' }),
        projectId: project.projectId,
        title: 'Second',
      })
      yield* sessions.start({ threadId: other.threadId, agentId: 'codex' })
      yield* until(turns(other.threadId), (rows) => rows.length >= 1 && rows.every(finished))

      yield* say(created.threadId, `${scenarios.run}echo first`)
      yield* say(other.threadId, `${scenarios.run}echo other`)
      yield* waitingCall(created.threadId)
      yield* waitingCall(other.threadId)

      yield* allow(created.taskId, true)
      // What waited on the person goes ahead; the other task's call still waits.
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['chosen=allow_once'])
      assert.lengthOf(yield* calls(other.threadId), 1)
      assert.deepStrictEqual((yield* queries.thread(created.threadId)).task.allowEverything, { task: true, project: false })
      assert.deepStrictEqual((yield* queries.thread(other.threadId)).task.allowEverything, { task: false, project: false })
      // Kept as the person's fact, once: turning it on again changes nothing.
      yield* allow(created.taskId, true)
      const facts = yield* sql<{ payload: string }>`
        SELECT payload FROM record_events WHERE aggregate_id = ${created.taskId} AND type = 'task.allow_everything_set'`
      assert.deepStrictEqual(
        facts.map((each) => JSON.parse(each.payload)),
        [{ allowEverything: true }],
      )

      // What it asks next goes ahead, with no one asked.
      yield* say(created.threadId, `${scenarios.run}echo second`)
      yield* ended(created.threadId, 2)
      assert.deepStrictEqual(yield* said(created.threadId), ['chosen=allow_once', 'chosen=allow_once'])
      assert.deepStrictEqual(yield* calls(created.threadId), [])

      // Off, it asks again.
      yield* allow(created.taskId, false)
      yield* say(created.threadId, `${scenarios.run}echo third`)
      const again = yield* waitingCall(created.threadId)
      assert.strictEqual(again.command, 'echo third')
      assert.deepStrictEqual((yield* queries.thread(created.threadId)).task.allowEverything, { task: false, project: false })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('clears a burst: what waits on a task goes ahead by its switch, and what waits anywhere in the project by the project’s', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const projects = yield* Projects
      const policies = yield* Policies
      const permissions = yield* Permissions
      const instance = yield* Instance
      const queries = yield* Queries
      const { project, task: created } = yield* working('ask')
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Second' }),
        projectId: project.projectId,
        title: 'Second',
      })
      yield* sessions.start({ threadId: other.threadId, agentId: 'codex' })
      yield* until(turns(other.threadId), (rows) => rows.length >= 1 && rows.every(finished))

      // Parallel tool calls, each a call of its own, waiting together.
      yield* say(created.threadId, `${scenarios.runEach}echo one; echo two; echo three`)
      yield* say(other.threadId, `${scenarios.runEach}echo four; echo five`)
      yield* waitingCalls(created.threadId, 3)
      yield* waitingCalls(other.threadId, 2)

      // The task's switch clears its own stack, not the other task's.
      yield* allow(created.taskId, true)
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['chosen=allow_once,allow_once,allow_once'])
      assert.deepStrictEqual(yield* calls(created.threadId), [])
      assert.lengthOf(yield* calls(other.threadId), 2)

      // The project's switch, as its rules screen sets it: the rules, then what waits decided again by them.
      yield* policies.set(project.projectId as ProjectId, { allowEverything: true }, instance.personId)
      yield* permissions.reconsider(project.projectId)
      yield* ended(other.threadId, 1)
      assert.deepStrictEqual(yield* said(other.threadId), ['chosen=allow_once,allow_once'])
      assert.deepStrictEqual(yield* calls(other.threadId), [])
      assert.deepStrictEqual((yield* queries.thread(other.threadId)).task.allowEverything, { task: false, project: true })
      const board = yield* queries.board(project.projectId)
      // Nothing waits on the person anywhere in the project.
      assert.deepStrictEqual(board.calls, [])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('refuses what Althar can’t read, with how to run it, while the project never allows something', () =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* working('ask')
      yield* policies.set(project.projectId as ProjectId, { never: ['delete-branch'] }, instance.personId)
      // A command that could deploy, by words Althar can't read until it runs.
      yield* say(created.threadId, `${scenarios.run}echo $(echo deploy)`)
      yield* waitingCall(created.threadId)
      yield* allow(created.taskId, true)
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['chosen=decline'])
      const [decision] = yield* sql<{ outcome: string; reason: string }>`
        SELECT d.outcome, d.reason FROM decisions d JOIN permission_requests r ON r.id = d.permission_request_id
        JOIN provider_sessions s ON s.id = r.provider_session_id JOIN threads t ON t.id = s.thread_id
        WHERE t.id = ${created.threadId} ORDER BY d.decided_at DESC LIMIT 1`
      assert.strictEqual(decision?.outcome, 'reject')
      assert.include(decision?.reason ?? '', 'spelled out')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says a call is held where a kind the project always asks about keeps it, and lets it through once everything is', () =>
    Effect.gen(function* () {
      const { task: created } = yield* working('rules')
      yield* say(created.threadId, `${scenarios.run}bun run deploy`)
      const call = yield* waitingCall(created.threadId)
      assert.isTrue(call.held)
      assert.deepStrictEqual(call.always?.allow, [])
      yield* allow(created.taskId, true)
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['chosen=allow_once'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.effect('refuses a task it doesn’t know', () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(allow('task_missing', true))
      assert.instanceOf(failed, NotFound)
    }).pipe(Effect.provide(runtime())),
  )
})
