import type { CoordinatorSnapshot, SessionSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { acceptingOf } from '../src/admission'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { COMPACT, Sessions } from '../src/Sessions'
import { repository, runtime, task, turns, until, withWork } from './support'

/*
 * The window and the runtime decide "this message goes to the queue" from
 * one answer: Sessions.placement, copied onto the snapshot as `accepting`.
 * A send while that answer is `queued` stays queued; while it is `now`, the
 * stored item is delivered as the next turn. Card phase and a review on
 * another thread are not this thread's admission. A wait for an agent slot
 * queues only when no session is held to take the send.
 */

const GB = 1024 ** 3

const withQueries = (options: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, options)))

const oneAtOnce = () => withQueries({ busy: { machine: { cores: 3, memory: 7 * GB } } })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  yield* coordinator.thread(project.projectId)
  return project.projectId as ProjectId
})

const started = (
  projectId: ProjectId,
  title: string,
  description: string,
  steps: ReadonlyArray<{ readonly key: 'implement' | 'review'; readonly agentId: string }> = [{ key: 'implement', agentId: 'codex' }],
) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description: withWork(
        description,
        steps.some((step) => step.key === 'review'),
      ),
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: instance.personId,
      end: null,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return created
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

const you = (items: ReadonlyArray<ThreadItem>, text: string) =>
  items.find((item): item is Extract<ThreadItem, { kind: 'user_message' }> => item.kind === 'user_message' && item.content.text === text)

const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string; holdReason: string | null }>`
      SELECT n.node_key AS step, a.state, a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** The stored item's placement matches what `accepting` said before the send. */
const lands = (item: Extract<ThreadItem, { kind: 'user_message' }> | undefined, accepting: 'now' | 'queued' | undefined) => {
  assert.strictEqual(item?.input?.state, accepting === 'queued' ? 'queued' : 'delivered')
}

const landed = (accepting: 'now' | 'queued' | undefined) => (accepting === 'queued' ? 'queued' : 'delivered')

describe('where a new message goes', () => {
  it('queues only for work already claimed on that thread', () => {
    const idle = {
      turnRunning: false,
      handingOver: false,
      nextLead: false,
      moved: false,
      starting: false,
      claimed: false,
      compactQueued: false,
      waitingForPlace: false,
    }
    assert.strictEqual(acceptingOf(idle), 'now')
    for (const flag of [
      'turnRunning',
      'handingOver',
      'nextLead',
      'moved',
      'starting',
      'claimed',
      'compactQueued',
      'waitingForPlace',
    ] as const)
      assert.strictEqual(acceptingOf({ ...idle, [flag]: true }), 'queued')
  })

  it.live('sends during a running turn stay queued, as accepting said, on a task and the coordinator', () => {
    const held = holds()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const coordinator = yield* Coordinator
      const { project, task: created } = yield* task()
      const coordinatorId = yield* coordinator.thread(project.projectId)
      const shown = (snapshot: ThreadSnapshot | CoordinatorSnapshot) => ({
        accepting: snapshot.accepting,
        items: snapshot.items,
        session: snapshot.session as SessionSummary | null,
      })
      const snapshotOf = (threadId: string) =>
        threadId === coordinatorId ? Effect.map(queries.coordinator(project.projectId), shown) : Effect.map(queries.thread(threadId), shown)
      for (const threadId of [created.threadId, coordinatorId]) {
        yield* say(threadId, threadId === coordinatorId ? 'Hello. [answers-after:20s]' : 'Hello. [lead:wait]')
        yield* sessions.start({ threadId, agentId: 'codex' })
        yield* until(
          Effect.map(sessions.running(threadId), (running) => (Option.exists(running, (one) => one.turnRunning) ? [true] : [])),
          (rows) => rows.length === 1,
        )
        const before = yield* snapshotOf(threadId)
        assert.strictEqual(before.accepting, 'queued')
        assert.strictEqual(before.session?.accepting, 'queued')
        const body = 'Then the changelog.'
        yield* say(threadId, body)
        const after = yield* until(snapshotOf(threadId), (snapshot) => you(snapshot.items, body) !== undefined)
        lands(you(after.items, body), before.accepting)
        assert.strictEqual(after.accepting, 'queued')
        held.open(threadId === coordinatorId ? '[answers-after:20s]' : '[lead:wait]')
        yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => row.state === 'completed'))
        assert.strictEqual((yield* snapshotOf(threadId)).accepting, 'now')
      }
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: held })))))
  })

  it.live('sends while a session is starting stay queued, as accepting said', () => {
    let goOn = () => {}
    const up = new Promise<void>((resolve) => (goOn = resolve))
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const starting = yield* Effect.forkChild(sessions.start({ threadId: created.threadId, agentId: 'codex' }))
      yield* until(sql<{ state: string }>`SELECT state FROM provider_sessions WHERE thread_id = ${created.threadId}`, (rows) =>
        rows.some((row) => row.state === 'starting'),
      )
      const read = queries.thread(created.threadId)
      const before = yield* read
      assert.strictEqual(before.accepting, 'queued')
      yield* say(created.threadId, 'While it starts.')
      const after = yield* until(read, (snapshot) => you(snapshot.items, 'While it starts.') !== undefined)
      lands(you(after.items, 'While it starts.'), before.accepting)
      goOn()
      yield* Fiber.join(starting)
    }).pipe(Effect.provide(withQueries({ each: { codex: { beforeNewSession: () => up } } })))
  })

  it.live('sends during a compaction stay queued, as accepting said', () => {
    let wait = false
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* say(created.threadId, 'Hello.')
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      assert.strictEqual((yield* queries.thread(created.threadId)).accepting, 'now')
      wait = true
      yield* sessions.compact({
        envelope: yield* Runtime.envelope('thread.compact', { threadId: created.threadId }),
        threadId: created.threadId,
      })
      yield* until(
        Effect.map(sessions.running(created.threadId), (running) => (Option.exists(running, (one) => one.turnRunning) ? [true] : [])),
        (rows) => rows.length === 1,
      )
      const sql = yield* SqlClient.SqlClient
      const [compacting] = yield* sql<{ prompt: string | null }>`
        SELECT prompt FROM turn_deliveries WHERE thread_id = ${created.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(compacting?.prompt, COMPACT)
      const read = queries.thread(created.threadId)
      const before = yield* read
      assert.strictEqual(before.accepting, 'queued')
      yield* say(created.threadId, 'After compact.')
      const after = yield* until(read, (snapshot) => you(snapshot.items, 'After compact.') !== undefined)
      lands(you(after.items, 'After compact.'), before.accepting)
      wait = false
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { connection: () => (wait ? 'waits' : undefined) })))))
  })

  it.live('sends on a task waiting for an agent slot stay queued, as accepting said', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const projectId = yield* opened
      const holder = yield* started(projectId, 'Holder', 'Work on it. [lead:wait]')
      yield* until(attempts(holder.taskId), (rows) => rows[0]?.state === 'running')
      const waiting = yield* started(projectId, 'Waiting', 'Do it. [lead:wait]')
      yield* until(attempts(waiting.taskId), (rows) => rows[0]?.holdReason === 'machine_busy')
      const before = yield* queries.thread(waiting.threadId)
      assert.strictEqual(before.accepting, 'queued')
      assert.isNull(before.session)
      yield* say(waiting.threadId, 'And the changelog.')
      const after = yield* until(
        queries.thread(waiting.threadId),
        (snapshot) => you(snapshot.items, 'And the changelog.')?.input?.state === landed(before.accepting),
      )
      lands(you(after.items, 'And the changelog.'), before.accepting)
    }).pipe(Effect.provide(oneAtOnce())),
  )

  it.live('sends between turns are taken now; after a lead change they stay queued, as accepting said', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* say(created.threadId, 'Hello.')
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      const idle = yield* queries.thread(created.threadId)
      assert.strictEqual(idle.accepting, 'now')
      yield* say(created.threadId, 'Between turns.')
      const delivered = yield* until(
        queries.thread(created.threadId),
        (snapshot) => you(snapshot.items, 'Between turns.')?.input?.state === landed(idle.accepting),
      )
      lands(you(delivered.items, 'Between turns.'), idle.accepting)
      yield* until(turns(created.threadId), (rows) => rows.length >= 2 && rows.every((row) => row.state === 'completed'))
      yield* until(
        Effect.map(queries.thread(created.threadId), (snapshot) => (snapshot.accepting === 'now' ? [true] : [])),
        (rows) => rows.length === 1,
      )
      yield* sessions.changeLead({ threadId: created.threadId, agentId: 'opencode' })
      const handing = yield* queries.thread(created.threadId)
      assert.strictEqual(handing.accepting, 'queued')
      yield* say(created.threadId, 'To OpenCode.')
      const handed = yield* until(queries.thread(created.threadId), (snapshot) => you(snapshot.items, 'To OpenCode.') !== undefined)
      lands(you(handed.items, 'To OpenCode.'), handing.accepting)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('sends while a review runs on another thread are taken now, as accepting said', () => {
    const held = holds()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const projectId = yield* opened
      const reviewed = yield* started(projectId, 'Reviewed', 'Do it. [lead:finish] [review:wait]', [
        { key: 'implement', agentId: 'codex' },
        { key: 'review', agentId: 'claude-code' },
      ])
      yield* until(attempts(reviewed.taskId), (rows) => rows.some((row) => row.step === 'review' && row.state === 'running'))
      yield* until(
        Effect.map(queries.thread(reviewed.threadId), (snapshot) => (snapshot.accepting === 'now' ? [true] : [])),
        (rows) => rows.length === 1,
      )
      const before = yield* queries.thread(reviewed.threadId)
      yield* say(reviewed.threadId, 'A note during review.')
      const noted = yield* until(
        queries.thread(reviewed.threadId),
        (snapshot) => you(snapshot.items, 'A note during review.')?.input?.state === landed(before.accepting),
      )
      lands(you(noted.items, 'A note during review.'), before.accepting)
      held.open('[review:wait]')
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: held })))))
  })
})
