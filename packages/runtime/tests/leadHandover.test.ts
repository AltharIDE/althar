import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { dueForLeadHandover, LEAD_HANDOVER_TOKENS, shrinks } from '../src/handover'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, repository, runtime, until } from './support'

/*
 * Althar hands a task's lead to a fresh session, briefed from the task,
 * only once its context is full (a task is a conversation plus parts, "A
 * lead's session lasts until it's full"): past 200,000 tokens, or 80% of
 * its window, whichever comes first. A break in its work (a step done, the
 * task made a change, a pause past its prompt cache's life) hands nothing
 * over, at any size. Never in a turn, and never while something it left
 * running still runs. The fake
 * agent says its context is as full as a message ending `[context:25/1000000]`
 * says: a quarter of a million-token window.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  yield* coordinator.thread(project.projectId)
  return project.projectId as ProjectId
})

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A task whose plan, its lead `agentId` and no review, the person starts now. */
const started = (projectId: ProjectId, description: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Lead' }),
      projectId,
      title: 'Lead',
      description,
      draft: true,
    })
    const actor = yield* person
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId, model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    yield* plans.start(planId, actor)
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

/** The thread's sessions, oldest first. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; agentId: string; accountId: string; state: string; supersededBySessionId: string | null }>`
      SELECT id, agent_id, account_id, state, superseded_by_session_id FROM provider_sessions
      WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** What the thread's turns were prompted with, oldest first, and which session each went to. */
const prompts = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string; providerSessionId: string; state: string }>`
      SELECT prompt, provider_session_id, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** Waits until the thread has had this many turns, each over, and its session waits for the next. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      prompts(threadId),
      (rows) => rows.length === count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) && !running.value.turnRunning ? [true] : [])),
      (rows) => rows.length === 1,
    )
  })

/** Waits until the lead's step is done, its one turn over. */
const finished = (threadId: string) => answered(threadId, 1)

/** The quiet lines in the thread. */
const titles = (threadId: string) => Effect.map(notices(threadId), (said) => said.map((notice) => notice.title))

const AFRESH = 'Started Fake codex afresh.'

describe('when to hand a lead over', () => {
  it('past its mark, or 80% of a smaller window, whichever comes first, and at no other size', () => {
    assert.strictEqual(LEAD_HANDOVER_TOKENS, 200_000)
    assert.isFalse(dueForLeadHandover(null))
    assert.isFalse(dueForLeadHandover({ used: 199_999, size: 1_000_000 }))
    assert.isTrue(dueForLeadHandover({ used: 200_000, size: 1_000_000 }))
    // A 200,000-token window fills to 80% first.
    assert.isFalse(dueForLeadHandover({ used: 159_999, size: 200_000 }))
    assert.isTrue(dueForLeadHandover({ used: 160_000, size: 200_000 }))
    // What a break once handed over, past 80,000, now carries on.
    assert.isFalse(dueForLeadHandover({ used: 100_000, size: 1_000_000 }))
    // An agent that hasn't said its window's size is never due.
    assert.isFalse(dueForLeadHandover({ used: 500_000, size: 0 }))
  })

  it('only where its brief is well under the context it replaces', () => {
    assert.isTrue(shrinks('x'.repeat(4 * 10_000), { used: 100_000 }))
    assert.isFalse(shrinks('x'.repeat(4 * 60_000), { used: 100_000 }))
    assert.isTrue(shrinks('a brief', null))
  })
})

describe('handing a lead to a fresh session', () => {
  it.live('hands one past its mark over before its next turn, on the same agent and account, briefed from the task', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Do it. [lead:finish]')
      yield* finished(task.threadId)
      // A turn that leaves a quarter of a million-token window full: past the lead's mark, though nowhere near 80%.
      yield* say(task.threadId, 'Look again. [context:25/1000000]')
      yield* answered(task.threadId, 2)
      assert.lengthOf(yield* sessionsOn(task.threadId), 1)

      // Its next turn starts in a fresh session, which takes what the person said after its brief.
      yield* say(task.threadId, 'And now?')
      const rows = yield* until(sessionsOn(task.threadId), (all) => all.length === 2 && all[1]?.state === 'active')
      const [old, fresh] = rows
      assert.strictEqual(old?.state, 'superseded')
      assert.strictEqual(old?.supersededBySessionId, fresh?.id)
      assert.deepStrictEqual([fresh?.agentId, fresh?.accountId], [old?.agentId, old?.accountId])
      assert.include(yield* titles(task.threadId), AFRESH)
      const [, , first] = yield* until(prompts(task.threadId), (all) => all.length === 3 && all[2]?.state === 'completed')
      assert.strictEqual(first?.providerSessionId, fresh?.id)
      assert.match(first?.prompt ?? '', /^You are carrying on a task an earlier session of yours worked on, in the same worktree/)
      assert.include(first?.prompt, 'Task: Lead')
      assert.include(first?.prompt, 'The thread so far, oldest first')
      assert.match(first?.prompt ?? '', /\n\nAnd now\?$/)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('carries the conversation on across a break, at any size under its mark', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Do it. [lead:finish]')
      yield* finished(task.threadId)
      // A hundred thousand tokens, mid-work: under the mark, so the next turn is in the same session.
      yield* say(task.threadId, 'Look again. [context:10/1000000]')
      yield* answered(task.threadId, 2)
      yield* say(task.threadId, 'And again.')
      yield* answered(task.threadId, 3)
      assert.lengthOf(yield* sessionsOn(task.threadId), 1)

      // The same, ending a round of work that changed it with finish_step: a break, which once started the next turn afresh.
      // Now the conversation carries on, with all the lead knows of the work.
      yield* say(task.threadId, 'Finish it. [lead:edit] [lead:finish] [context:10/1000000]')
      yield* answered(task.threadId, 4)
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(task.threadId)),
        (busy) => !busy,
      )
      yield* say(task.threadId, 'What next?')
      yield* answered(task.threadId, 5)
      assert.lengthOf(yield* sessionsOn(task.threadId), 1)
      assert.notInclude(yield* titles(task.threadId), AFRESH)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves one as it is while something it left running still runs, which a fresh session would stop', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const projectId = yield* opened
      const task = yield* started(projectId, 'Serve it, then finish. [lead:serve] [lead:finish]', 'claude-code')
      yield* finished(task.threadId)
      yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
        (left) => left.length === 1,
      )
      yield* say(task.threadId, 'Look again. [context:25/1000000]')
      yield* answered(task.threadId, 2)
      yield* say(task.threadId, 'And now?')
      yield* answered(task.threadId, 3)
      assert.lengthOf(yield* sessionsOn(task.threadId), 1)
      assert.isFalse((yield* titles(task.threadId)).some((title) => title?.includes('afresh') === true))
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a session its agent has lost', () => {
  // Claude Code's adapter drops a session whose process died (a `pkill -f` matched it, on 2 November 2026), and answers its
  // next prompt with "Resource not found": the turn is given to a fresh session, briefed from the task, not failed.
  it.live('starts the lead afresh with what the person said, rather than fail the turn', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const task = yield* started(projectId, 'Do it. [lead:finish]')
      yield* finished(task.threadId)

      yield* say(task.threadId, 'Look again. [lead:lost-once]')
      const [old, fresh] = yield* until(sessionsOn(task.threadId), (all) => all.length === 2 && all[1]?.state === 'active')
      assert.strictEqual(old?.state, 'superseded')
      assert.deepStrictEqual([fresh?.agentId, fresh?.accountId], [old?.agentId, old?.accountId])
      const [, lost, first] = yield* until(prompts(task.threadId), (all) => all.length === 3 && all[2]?.state === 'completed')
      assert.deepStrictEqual([lost?.providerSessionId, lost?.state], [old?.id, 'failed'])
      const [failed] = yield* sql<{ errorClass: string | null }>`
        SELECT error_class FROM turn_deliveries WHERE thread_id = ${task.threadId} AND state = 'failed'`
      assert.strictEqual(failed?.errorClass, 'session_lost')
      // What the person said goes to the fresh session, after its brief.
      assert.strictEqual(first?.providerSessionId, fresh?.id)
      assert.match(
        first?.prompt ?? '',
        /^You are carrying on a task an earlier session of yours worked on, in the same worktree: Althar started you afresh because that session was lost\./,
      )
      assert.match(first?.prompt ?? '', /\n\nLook again\. \[lead:lost-once\]$/)
      // Said plainly, once, and not as a turn that couldn't answer.
      const said = yield* titles(task.threadId)
      assert.include(said, 'Fake codex had lost this conversation. Started it afresh.')
      assert.isFalse(said.some((title) => title?.includes("couldn't answer") === true))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('carries a step on from its first turn, the fresh session briefed with it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const task = yield* started(projectId, 'Do it. [lead:lost-once] [lead:finish]')
      const [, fresh] = yield* until(sessionsOn(task.threadId), (all) => all.length === 2 && all[1]?.state === 'active')
      yield* until(sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE provider_session_id = ${fresh?.id ?? ''}`, (rows) =>
        rows.some((row) => row.state === 'completed'),
      )
      const [step] = yield* until(sql<{ state: string }>`SELECT state FROM nodes WHERE node_key = 'implement'`, (rows) =>
        rows.some((row) => row.state !== 'running' && row.state !== 'ready' && row.state !== 'pending'),
      )
      assert.strictEqual(step?.state, 'succeeded')
      assert.include(yield* titles(task.threadId), 'Fake codex had lost this conversation. Started it afresh.')
    }).pipe(Effect.provide(withQueries())),
  )
})
