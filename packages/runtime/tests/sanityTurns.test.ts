import { Ids, newId, now, type ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { fact } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, repository, runtime, task, turns, until } from './support'

/*
 * A sanity pass over the coordinator's and leads' turns: what the person
 * says, what waits, what fails and what carries on. Each test here asserts
 * the behaviour the docs describe; those marked `.fails` show a defect that
 * is there today, and flip to passing once it is fixed.
 */

/** Whether a turn is over, however it ended. */
const over = (row: { readonly state: string }) => row.state !== 'pending' && row.state !== 'delivered'

/** What the person says to a thread from the window. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      sender: { kind: 'window' },
    })
  })

/** A project in a repository of its own, and its coordinator's thread. */
const coordinatorProject = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const projectId = opened.projectId as ProjectId
  return { projectId, threadId: yield* coordinator.thread(projectId) }
})

/** What the person says to the coordinator from the window. */
const tell = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    yield* coordinator.say({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
      sender: { kind: 'window' },
    })
  })

/** A pull request a task of the project follows, and a way to record news of it, as the host watch does. */
const followedPullRequest = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'A change',
      draft: true,
    })
    const id = yield* newId(Ids.externalLink)
    const at = yield* now
    yield* sql`INSERT INTO external_links ${sql.insert({
      id,
      projectId,
      taskId: created.taskId,
      product: 'github',
      kind: 'change',
      externalId: '42',
      ref: 'api#42',
      key: '#42',
      url: 'https://github.com/org/api/pull/42',
      snapshot: JSON.stringify({ number: 42 }),
      createdAt: at,
      updatedAt: at,
    })}`
    return (payload: unknown) =>
      fact({
        projectId,
        aggregateType: 'external_link',
        aggregateId: id,
        revision: 1,
        type: 'external_link.news',
        payload,
        actorId: instance.systemId,
      })
  })

describe('a lead talked to between steps', () => {
  // Finding (sanity pass): a person's message to a lead outside a step (after its plan, or on a task with none) whose turn
  // fails on the agent's service is never said in the thread, never tried again, and offers no Try again: Sessions counts a
  // lead's transient failure as "said elsewhere", but Runs says it only for a step. Flips to passing when fixed.
  it.live.fails('says so in its thread when its turn fails on the agent’s service, as the coordinator’s chat does', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every(over))
      const asked = yield* say(created.threadId, 'Look at the retry. [overloaded]')
      const ended = yield* until(turns(created.threadId), (rows) => rows.length >= 2 && rows.every(over))
      assert.deepStrictEqual(
        ended.map((turn) => [turn.state, turn.errorClass]),
        [
          ['completed', null],
          ['failed', 'transient'],
        ],
      )
      // The person's words wait for the agent again, but nothing will deliver them: the thread must say what happened.
      const sql = yield* SqlClient.SqlClient
      const waiting = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${asked.inputId}`
      assert.strictEqual(waiting[0]?.state, 'queued')
      const failed = (yield* notices(created.threadId)).filter((notice) => notice['severity'] === 'error')
      assert.lengthOf(failed, 1, 'the failed turn is said in the thread, with its way out')
    }).pipe(Effect.provide(runtime())),
  )

  // Finding (sanity pass), the same defect's other face: the person's words that failed turn put back in the queue count, for
  // Busy, as the lead's next turn on its way, so the idle lead holds a place among the agents at work (and Quit counts it as
  // a lead at work) for as long as its session lasts, though nothing will ever deliver them. Flips to passing when fixed.
  it.live.fails('holds no place among the agents at work once that turn has failed and nothing is under way', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const busy = yield* Busy
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every(over))
      assert.lengthOf((yield* busy.now).holders, 0)
      yield* say(created.threadId, 'Look at the retry. [overloaded]')
      yield* until(turns(created.threadId), (rows) => rows.length >= 2 && rows.every(over))
      assert.isFalse(Option.exists(yield* sessions.running(created.threadId), (session) => session.turnRunning))
      assert.deepStrictEqual(
        (yield* busy.now).holders.map((holder) => holder.taskId),
        [],
        'an idle lead whose turn failed is not at work',
      )
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a lead handed to another agent', () => {
  // Finding (sanity pass): Sessions.switchAgent (a usage limit that moves on, a step handed on, a stalled lead started afresh)
  // leaves the outgoing session taking turns until the new agent is up, unlike handOver and takeOver, which mark it
  // `under_way`: what the person says meanwhile becomes the old agent's turn, cut off as it stops, and the agent taking over
  // is told only to carry on. Flips to passing when fixed.
  it.live.fails('gives what the person says while the new agent starts to the new agent, not the one being stopped', () => {
    const held = holds()
    // The agent taking over is slow to make its session, as a real one starting is, until the test lets it.
    const starting: { gate: Promise<void> | undefined; open: () => void } = { gate: undefined, open: () => {} }
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every(over))
      starting.gate = new Promise<void>((resolve) => (starting.open = resolve))
      // Althar hands the lead over, as at a usage limit that moves on, or a step handed on for want of a report.
      const switched = yield* Effect.forkChild(sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' }))
      const sessionsOf = sql<{ id: string; agentId: string; state: string }>`
        SELECT id, agent_id, state FROM provider_sessions WHERE thread_id = ${created.threadId} ORDER BY started_at, rowid`
      yield* until(sessionsOf, (rows) => rows.some((row) => row.agentId === 'opencode'))
      // Meanwhile the person writes.
      const asked = yield* say(created.threadId, 'Also check the refund path. [answers-after:5s]')
      const given = sql<{ sessionId: string; state: string }>`
        SELECT d.provider_session_id AS session_id, d.state FROM turn_delivery_inputs i JOIN turn_deliveries d ON d.id = i.delivery_id
        WHERE i.user_input_id = ${asked.inputId} ORDER BY d.requested_at, d.rowid`
      // The new agent is ready: the old one stops, and the new one takes the thread; then whatever has the words answers them.
      yield* until(given, (rows) => rows.length > 0)
      starting.open()
      yield* Fiber.join(switched)
      held.open('[answers-after:5s]')
      const [old, fresh] = yield* until(sessionsOf, (rows) => rows[1]?.state === 'active')
      assert.strictEqual(old?.state, 'superseded')
      yield* until(turns(created.threadId), (rows) => rows.some((row) => row.providerSessionId === fresh?.id) && rows.every(over))
      assert.deepStrictEqual(
        (yield* given).map((turn) => [turn.sessionId === fresh?.id ? 'taking over' : 'stopped', turn.state]),
        [['taking over', 'completed']],
        'the person’s words are a turn of the agent taking over',
      )
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          { holds: held },
          {
            each: { opencode: { beforeNewSession: () => starting.gate ?? Promise.resolve() } },
            // An agent that doesn't stop when asked is stopped with its process after this.
            stopGrace: Duration.seconds(1),
          },
        ),
      ),
    )
  })
})

describe('a stop', () => {
  // Finding (sanity pass): stopRunning cancels the agent at once, though a turn being prepared hasn't sent its prompt yet, so
  // the cancel lands on no turn; deliver never looks at `stopping` again, the prompt goes out after the stop, the agent works on
  // it until the stop's grace is up, and its turn is recorded as the agent dying (failed, agent_exited). Flips to passing when fixed.
  it.live.fails('that comes as a turn is being prepared stops it, rather than letting it out to run until the agent is killed', () => {
    const held = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every(over))
      const asked = yield* say(created.threadId, 'Look at the refund path. [answers-after:5s]')
      // The turn has taken the person's words, and is on its way to the agent: the person presses Stop.
      yield* until(
        sql<{ id: string }>`SELECT delivery_id AS id FROM turn_delivery_inputs WHERE user_input_id = ${asked.inputId}`,
        (rows) => rows.length > 0,
      )
      yield* sessions.stop(created.threadId)
      const ended = yield* until(turns(created.threadId), (rows) => rows.length >= 2 && rows.every(over))
      assert.deepStrictEqual(
        [ended[1]?.state, ended[1]?.errorClass],
        ['interrupted', null],
        'the turn is stopped as asked, not cut off with its agent',
      )
    }).pipe(Effect.provide(runtime(':memory:', { holds: held }, { stopGrace: Duration.seconds(1) })))
  })
})

describe('what the person says first', () => {
  // Finding (sanity pass): a fresh session's first prompt says the person's waiting message twice: once in its brief's "thread
  // so far" (the transcript reads the queued message's thread item) and once as the message itself. The same on a handover's
  // and a takeover's brief. Flips to passing when fixed.
  it.live.fails('reaches the coordinator once in its first turn, not again in its brief’s “thread so far”', () =>
    Effect.gen(function* () {
      const { threadId } = yield* coordinatorProject
      const asked = 'Plan the checkout retry, and keep it small.'
      yield* tell(threadId, asked)
      const [first] = yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every(over))
      assert.include(first?.prompt ?? '', asked)
      assert.strictEqual((first?.prompt ?? '').split(asked).length - 1, 1, 'the message is said once')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the coordinator’s news', () => {
  // Finding (sanity pass): news told only in a coordinator turn that failed (its service, a usage limit, a refused prompt) is
  // never told again: coordinatorNews reads what is new since the last turn *requested*, failed or not. Flips to passing when fixed.
  it.live.fails('is told again with Try again when the turn that carried it failed before the agent read it', () => {
    const state: { down: 'offline' | undefined } = { down: undefined }
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { projectId, threadId } = yield* coordinatorProject
      const record = yield* followedPullRequest(projectId)
      yield* tell(threadId, 'Hello.')
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every(over))
      // The pull request merges while the coordinator isn't speaking.
      yield* record({ kind: 'merged' })
      // The person asks; the coordinator's service is out of reach for that turn.
      state.down = 'offline'
      yield* tell(threadId, 'What changed?')
      const failed = yield* until(turns(threadId), (rows) => rows.length >= 2 && rows.every(over))
      assert.strictEqual(failed[1]?.state, 'failed')
      assert.include(failed[1]?.prompt ?? '', 'Pull request #42: Merged.')
      // Back, the person presses Try again: the coordinator still hasn't heard that #42 merged.
      state.down = undefined
      assert.isTrue(yield* sessions.tryAgain(threadId))
      const again = yield* until(turns(threadId), (rows) => rows.length >= 3 && rows.every(over))
      assert.strictEqual(again[2]?.state, 'completed')
      assert.include(again[2]?.prompt ?? '', 'What changed?')
      assert.include(again[2]?.prompt ?? '', 'Pull request #42: Merged.', 'the merge is told in the turn the agent reads')
    }).pipe(Effect.provide(runtime(':memory:', { connection: () => state.down })))
  })

  // Finding (sanity pass), the same cause on the person's own Compact: the compaction turn carries no news but is recorded as a
  // turn requested, so what happened before it is never told. Flips to passing when fixed.
  it.live.fails('is told after the person compacts its context, though the compaction turn carried none', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { projectId, threadId } = yield* coordinatorProject
      const record = yield* followedPullRequest(projectId)
      yield* tell(threadId, 'Hello.')
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every(over))
      // The pull request merges while the coordinator isn't speaking; the person then presses Compact in the context ring.
      yield* record({ kind: 'merged' })
      yield* sessions.compact({ envelope: yield* Runtime.envelope('thread.compact', { threadId }), threadId })
      const compacted = yield* until(turns(threadId), (rows) => rows.length >= 2 && rows.every(over))
      assert.deepStrictEqual([compacted[1]?.state, compacted[1]?.prompt], ['completed', '/compact'])
      // What the person asks next is the first turn that can carry the news.
      yield* tell(threadId, 'What changed?')
      const next = yield* until(turns(threadId), (rows) => rows.length >= 3 && rows.every(over))
      assert.include(next[2]?.prompt ?? '', 'What changed?')
      assert.include(next[2]?.prompt ?? '', 'Pull request #42: Merged.', 'the merge is told in the turn after the compaction')
    }).pipe(Effect.provide(runtime())),
  )
})
