import type { QuestionField } from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from '../src/errors'
import { questionTitle, Questions, reasonOf } from '../src/Questions'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * A question's answer kept for later (Busy.ts): answered while every agent
 * this machine runs at once is at work, it is told to the agent waiting on it
 * once there is a place, once; and what a question says of itself in a line.
 */

const database: QuestionField = {
  id: 'database',
  question: 'Which database should the cache use?',
  type: 'choice',
  options: [
    { value: 'sqlite', label: 'SQLite' },
    { value: 'redis', label: 'Redis' },
  ],
  multiple: false,
  required: true,
}

/** A question asked on a new task's thread by its lead, once its brief's turn ended: the agent waiting on it, forked. */
const asked = Effect.gen(function* () {
  const questions = yield* Questions
  const sessions = yield* Sessions
  const sql = yield* SqlClient.SqlClient
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
  const context = { projectId: project.projectId as ProjectId, threadId: created.threadId, taskId: created.taskId, sessionId }
  const waiting = yield* Effect.forkChild(questions.ask(context, { message: 'One thing first.', fields: [database] }))
  const [row] = yield* until(
    sql<{ id: string; state: string }>`SELECT id, state FROM attention_requests WHERE kind = 'question'`,
    (rows) => rows.length === 1,
  )
  return { waiting, attentionId: row?.id ?? '', context }
})

const answer = (attentionId: string, keep?: boolean) =>
  Effect.gen(function* () {
    const questions = yield* Questions
    return yield* questions.answer({
      envelope: yield* Runtime.envelope('attention.answer_question', {}),
      attentionId,
      answers: { database: { values: ['sqlite'] } },
      ...(keep === undefined ? {} : { keep }),
    })
  })

const stateOf = (attentionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; payload: string }>`SELECT state, payload FROM attention_requests WHERE id = ${attentionId}`
    return { state: row?.state, payload: JSON.parse(row?.payload ?? '{}') as { waitsForPlace?: string } }
  })

describe('an answer kept until there is a place', () => {
  it.live('is told to its agent once there is one, and only once', () =>
    Effect.gen(function* () {
      const questions = yield* Questions
      const { waiting, attentionId } = yield* asked
      // Kept: answering says nothing more is to be done now, and the call is answered.
      assert.deepStrictEqual(yield* answer(attentionId, true), { told: true, kept: true })
      assert.strictEqual((yield* stateOf(attentionId)).state, 'answered')
      // This machine has room, so the agent has the person's answer, and the call no longer waits for a place.
      assert.deepStrictEqual(yield* Fiber.join(waiting), { action: 'accept', content: { database: 'sqlite' } })
      yield* until(
        Effect.map(stateOf(attentionId), (now) => [now]),
        ([now]) => now?.payload.waitsForPlace === undefined,
      )
      // Told again, or of a question there never was, it is told as nothing.
      assert.deepStrictEqual(yield* questions.tell(attentionId), { told: true })
      assert.deepStrictEqual(yield* questions.tell('att_none'), { told: true })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is told as nothing while the question is still open', () =>
    Effect.gen(function* () {
      const questions = yield* Questions
      const { waiting, attentionId } = yield* asked
      assert.deepStrictEqual(yield* questions.tell(attentionId), { told: true })
      assert.strictEqual((yield* stateOf(attentionId)).state, 'open')
      yield* Fiber.interrupt(waiting)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a question that can’t be asked or answered', () => {
  it.live('is cancelled for the agent where it asks nothing, or can’t be recorded, and nothing waits on the person', () =>
    Effect.gen(function* () {
      const questions = yield* Questions
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task()
      const context = { projectId: project.projectId as ProjectId, threadId: created.threadId, taskId: created.taskId, sessionId: 'ps' }
      assert.deepStrictEqual(yield* questions.ask(context, { message: 'Anything?', fields: [] }), { action: 'cancel' })
      // A thread that isn't there: nothing can be recorded, so the agent carries on.
      assert.deepStrictEqual(yield* questions.ask({ ...context, threadId: 'th_gone' }, { message: 'Which?', fields: [database] }), {
        action: 'cancel',
      })
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says a question that isn’t there isn’t', () =>
    Effect.gen(function* () {
      assert.instanceOf(yield* Effect.flip(answer('att_none')), NotFound)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a question in a line', () => {
  it('is its first question, or what the agent said where it asks none', () => {
    assert.strictEqual(questionTitle({ message: 'Please answer these.', fields: [database] }), 'Which database should the cache use?')
    assert.strictEqual(questionTitle({ message: 'Please answer these.', fields: [] }), 'Please answer these.')
  })

  it('cuts a why with no word to break at at its length', () => {
    const why = reasonOf(`${'a'.repeat(300)}.`, [])
    assert.strictEqual(why, `${'a'.repeat(199)}…`)
  })
})
