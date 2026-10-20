import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, task, turns, until } from './support'

/*
 * What the person's calls into a task's runs do at their edges, as the
 * window makes them: answering a question the coordinator or a gone agent
 * asked, telling an agent at work an answer, skipping a review there is
 * none of, publishing a task that was abandoned, and a plan whose project
 * was removed.
 */

/** The thread's one open question. */
const openQuestion = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* until(
      sql<{ id: string }>`
        SELECT id FROM attention_requests WHERE kind = 'question' AND state = 'open' AND json_extract(payload, '$.threadId') = ${threadId}`,
      (rows) => rows.length === 1,
    )
    return row?.id ?? ''
  })

/** What the agents on the thread said, in order. */
const replies = (threadId: string) =>
  Effect.map(items(threadId), (rows) => rows.flatMap((item) => (item.kind === 'agent_message' ? [String(item.content.text)] : [])))

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

/** Waits for the thread's turns to be over, this many at least. */
const settled = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.length >= count && rows.every((row) => !['pending', 'delivered'].includes(row.state)))

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as Parameters<Plans['Service']['hold']>[1]
})

describe('the person answering a question, through the runs', () => {
  it.live("tells the coordinator its answer at once, as it asked with no task's place to wait for", () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const coordinator = yield* Coordinator
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      for (const body of ['hello', scenarios.question]) {
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        if (body === 'hello') yield* settled(threadId, 1)
      }
      const question = yield* openQuestion(threadId)
      yield* runs.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: question,
        answers: { database: { values: ['postgres'] } },
      })
      yield* until(replies(threadId), (said) => said.includes('answer={"database":"postgres"}'))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('starts the agent last on the thread again for an answer to a question whose agent has gone', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* settled(created.threadId, 1)
      yield* say(created.threadId, scenarios.question)
      const question = yield* openQuestion(created.threadId)
      yield* sessions.stop(created.threadId)
      yield* runs.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: question,
        answers: { database: { values: ['sqlite'] } },
      })
      assert.include(
        yield* until(replies(created.threadId), (said) => said.some((text) => text.startsWith('told='))),
        'told=Which database? sqlite',
      )
      assert.strictEqual(Option.getOrUndefined(yield* sessions.running(created.threadId))?.agentId, 'codex')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('tells an answer to the agent on the thread, without starting another', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* settled(created.threadId, 1)
      const body = 'The person answered your question:\nWhich database? sqlite'
      yield* runs.answered({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: created.threadId, body })
      assert.include(
        yield* until(replies(created.threadId), (said) => said.some((text) => text.startsWith('told='))),
        'told=Which database? sqlite',
      )
      const [one] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${created.threadId}`
      assert.strictEqual(one?.n, 1)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the person skipping a review', () => {
  it.live('does nothing for a task with no run, or one whose plan has no review', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const plans = yield* Plans
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const { project, task: idle } = yield* task('Nothing running')
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('run.skip_review', {}), taskId: idle.taskId })
      assert.lengthOf(yield* sql`SELECT id FROM runs WHERE task_id = ${idle.taskId}`, 0)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'No review',
        description: 'Work on it. [lead:wait]',
        draft: true,
      })
      const actor = yield* person
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      yield* until(sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${created.taskId}`, (rows) => rows[0]?.state === 'running')
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('run.skip_review', {}), taskId: created.taskId })
      const [run] = yield* sql<{ state: string; parameters: string }>`SELECT state, parameters FROM runs WHERE task_id = ${created.taskId}`
      assert.strictEqual(run?.state, 'running')
      assert.notInclude(run?.parameters ?? '', '"skipped":true')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a task after its plan', () => {
  it.live("keeps no summary from a session that isn't its lead's", () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Done once',
        description: 'Do it. [lead:finish]',
        draft: true,
      })
      const actor = yield* person
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      yield* until(
        sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${created.taskId}`,
        (rows) => rows[0]?.state === 'succeeded',
      )
      const stranger: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'sess_elsewhere',
        taskId: created.taskId,
      }
      assert.strictEqual(
        yield* callTool(stranger, 'finish_step', { summary: 'Did more.', built: 'More.' }),
        'No step is waiting on you, so Althar keeps no summary now.',
      )
      assert.lengthOf(yield* sql`SELECT id FROM runs WHERE task_id = ${created.taskId}`, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('opens no pull request for a task that was abandoned', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const tasks = yield* Tasks
      const { task: created } = yield* task('Given up')
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: created.taskId })
      assert.deepInclude(yield* Effect.flip(runs.publish(created.taskId)), { _tag: 'NoChangeToOpen', why: 'settled' })
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a plan whose project was removed', () => {
  it.live('gets no run', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const plans = yield* Plans
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Planned',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: yield* person,
      })
      yield* projects.remove(project.projectId)
      assert.instanceOf(yield* Effect.flip(runs.run(planId)), NotFound)
      assert.lengthOf(yield* sql`SELECT id FROM runs WHERE task_id = ${created.taskId}`, 0)
    }).pipe(Effect.provide(runtime(':memory:', {}, { countdown: Duration.minutes(5) }))),
  )
})
