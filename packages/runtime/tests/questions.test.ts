import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { AttentionClosed, QuestionUnanswered } from '../src/errors'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { callWords } from '../src/Nudges'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Questions } from '../src/Questions'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { items, repository, runtime, task, turns, until } from './support'

/*
 * Questions an agent asks the person (DEV-13): one waits in the thread and
 * on the person until they answer it; its answer reaches the agent that
 * asked, or, if that agent has gone meanwhile, the one on the thread next.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

/** Starts the lead on a thread, and waits for its brief's turn to end. */
const lead = (threadId: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const sessionId = yield* sessions.start({ threadId, agentId })
    yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
    return sessionId
  })

/** The thread's one open question. */
const openQuestion = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* until(
      sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests
        WHERE kind = 'question' AND state = 'open' AND json_extract(payload, '$.threadId') = ${threadId}`,
      (rows) => rows.length === 1,
    )
    return { id: row?.id ?? '', payload: JSON.parse(row?.payload ?? '{}') as { sessionId: string; withdrawn?: string } }
  })

const answer = (attentionId: string, answers: Readonly<Record<string, { values: ReadonlyArray<string>; words?: string }>>) =>
  Effect.gen(function* () {
    const questions = yield* Questions
    return yield* questions.answer({ envelope: yield* Runtime.envelope('attention.answer_question', {}), attentionId, answers })
  })

const sessionState = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
    return row?.state
  })

/** What the agents on the thread said, in order. */
const replies = (threadId: string) =>
  Effect.map(items(threadId), (rows) => rows.flatMap((item) => (item.kind === 'agent_message' ? [String(item.content.text)] : [])))

/** The question as the thread shows it. */
const shown = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.thread(threadId))
    return snapshot.items.flatMap((item) => (item.kind === 'question' ? [item.content] : []))
  })

describe('questions an agent asks the person', () => {
  it.live('wait on the person in the thread, and give the agent their answer in its own fields', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const { task: created } = yield* task()
      const sessionId = yield* lead(created.threadId)
      yield* say(created.threadId, scenarios.questions)
      const question = yield* openQuestion(created.threadId)
      assert.strictEqual(question.payload.sessionId, sessionId)
      assert.strictEqual(yield* sessionState(sessionId), 'waiting_approval')

      // In the thread, where it was asked, standing for the agent's tool call; and as a call on the task.
      const [asked] = yield* shown(created.threadId)
      assert.deepStrictEqual(
        [asked?.state, asked?.toolCallId, asked?.fields.map((field) => [field.question, field.multiple])],
        [
          'open',
          'ask-1',
          [
            ['Which database should the cache use?', false],
            ['Which checks should run before it lands?', true],
          ],
        ],
      )
      const snapshot = yield* Effect.orDie(queries.thread(created.threadId))
      assert.deepStrictEqual(
        snapshot.attention.map((call) => [call.kind, call.title, call.question?.fields.length]),
        [['question', 'Which database should the cache use?', 2]],
      )

      // Each question needs an answer: an option, or words where the agent takes them.
      const missing = yield* Effect.flip(answer(question.id, { question_0: { values: ['SQLite'] } }))
      assert.instanceOf(missing, QuestionUnanswered)
      assert.strictEqual(missing.field, 'question_1')

      const told = yield* answer(question.id, {
        question_0: { values: [], words: 'DuckDB' },
        question_1: { values: ['Unit tests', 'Lint', 'Not offered'] },
      })
      assert.deepStrictEqual(told, { told: true })
      yield* until(replies(created.threadId), (said) => said.some((text) => text.startsWith('answer=')))
      assert.include(yield* replies(created.threadId), 'answer={"question_0_custom":"DuckDB","question_1":["Unit tests","Lint"]}')
      assert.strictEqual(yield* sessionState(sessionId), 'active')

      // Every window hears the question's item changed, and reads it again.
      const [heard] = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM change_log c JOIN thread_items i ON i.id = c.aggregate_id
        WHERE c.aggregate_type = 'thread_item' AND i.kind = 'question' AND i.thread_id = ${created.threadId}`
      assert.isAtLeast(heard?.n ?? 0, 2)
      const [settled] = yield* shown(created.threadId)
      assert.deepStrictEqual(
        [settled?.state, settled?.answers],
        ['answered', { question_0: { values: [], words: 'DuckDB' }, question_1: { values: ['Unit tests', 'Lint'] } }],
      )
      const decisions = yield* sql<{ outcome: string; reason: string; actor: string }>`
        SELECT d.outcome, d.reason, a.kind AS actor FROM decisions d JOIN actors a ON a.id = d.decided_by_actor_id
        WHERE d.attention_request_id = ${question.id}`
      assert.deepStrictEqual(decisions, [
        {
          outcome: 'answer',
          reason: 'Which database should the cache use? DuckDB\nWhich checks should run before it lands? Unit tests, Lint',
          actor: 'person',
        },
      ])
      assert.deepStrictEqual((yield* Effect.orDie(queries.thread(created.threadId))).attention, [])
      // Answered once; again is too late.
      assert.instanceOf(yield* Effect.flip(answer(question.id, { question_0: { values: ['SQLite'] } })), AttentionClosed)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('are withdrawn when the turn that asked is stopped', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      const sessionId = yield* lead(created.threadId)
      yield* say(created.threadId, scenarios.question)
      const question = yield* openQuestion(created.threadId)
      yield* say(created.threadId, 'never mind', 'interrupt_and_continue')
      yield* until(replies(created.threadId), (said) => said.includes('answer=cancel'))
      const [withdrawn] = yield* until(shown(created.threadId), (rows) => rows[0]?.state === 'withdrawn')
      assert.strictEqual(withdrawn?.withdrawn, 'turn')
      yield* until(
        Effect.map(sessionState(sessionId), (state) => [state]),
        ([state]) => state === 'active',
      )
      assert.instanceOf(yield* Effect.flip(answer(question.id, { database: { values: ['sqlite'] } })), AttentionClosed)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stay open when the agent that asked goes, and their answer goes to the agent that starts next', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const runs = yield* Runs
      const { task: created } = yield* task()
      yield* lead(created.threadId)
      yield* say(created.threadId, scenarios.question)
      const question = yield* openQuestion(created.threadId)
      yield* sessions.stop(created.threadId)
      yield* until(
        Effect.map(sessions.running(created.threadId), (running) => (Option.isNone(running) ? [true] : [])),
        (rows) => rows.length === 1,
      )
      assert.strictEqual((yield* shown(created.threadId))[0]?.state, 'open')

      const told = yield* answer(question.id, { database: { values: ['sqlite'] } })
      assert.isFalse(told.told)
      if (told.told) return
      yield* runs.answered({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: told.threadId, body: told.body })
      const said = yield* until(replies(created.threadId), (rows) => rows.some((text) => text.startsWith('told=')))
      assert.include(said, 'told=Which database? sqlite')
      // Told quietly: the thread shows the question answered, not a message from the person.
      assert.deepStrictEqual(
        (yield* items(created.threadId)).filter((item) => item.kind === 'user_message').map((item) => item.content.text),
        [scenarios.question],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("stay open across a restart: the lead's step waits on the answer, then carries on with it", () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-questions-')), 'althar.sqlite')
      const started = yield* Effect.gen(function* () {
        const plans = yield* Plans
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
        const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Pick the cache database',
          description: 'Ask which database first. [lead:ask]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: actor,
        })
        yield* plans.start(planId, actor)
        yield* openQuestion(created.threadId)
        return created
      }).pipe(Effect.provide(withQueries(file)))

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const runs = yield* Runs
        // Nothing stuck: the question is what the step waits on.
        const calls = yield* sql<{
          kind: string
          state: string
        }>`SELECT kind, state FROM attention_requests WHERE task_id = ${started.taskId}`
        assert.deepStrictEqual(calls, [{ kind: 'question', state: 'open' }])
        const [attempt] = yield* sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'implement'`
        assert.strictEqual(attempt?.state, 'waiting_attention')

        const question = yield* openQuestion(started.threadId)
        const told = yield* answer(question.id, { question_0: { values: ['Postgres'] } })
        if (told.told) return assert.fail('the agent that asked has gone')
        yield* runs.answered({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: told.threadId, body: told.body })
        assert.include(
          yield* until(replies(started.threadId), (rows) => rows.some((text) => text.startsWith('told='))),
          'told=Which database should the cache use? Postgres',
        )
        const [running] = yield* until(
          sql<{ state: string }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'implement'`,
          (rows) => rows[0]?.state === 'running',
        )
        assert.strictEqual(running?.state, 'running')
      }).pipe(Effect.provide(withQueries(file)))
    }),
  )

  it.live('are offered to the lead, not to a reviewer, which is given no way to ask', () =>
    Effect.gen(function* () {
      const offered: Array<unknown> = []
      yield* Effect.gen(function* () {
        const plans = yield* Plans
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
        const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Looked at',
          description: '[lead:finish]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: created.taskId,
          steps: [
            { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
            { key: 'review', agentId: 'codex', model: null, skipped: false },
          ],
          reason: null,
          actorId: actor,
        })
        yield* plans.start(planId, actor)
        yield* until(
          sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${created.taskId} AND kind = 'step'`,
          (rows) => rows.length === 1,
        )
        yield* until(
          Effect.sync(() => offered),
          (rows) => rows.length >= 2,
        )
      }).pipe(Effect.provide(withQueries(':memory:', { initialized: (capabilities) => offered.push(capabilities?.elicitation ?? null) })))
      assert.deepStrictEqual(offered.slice(0, 2), [{ form: {} }, null])
    }),
  )

  it("from the coordinator wait in its conversation, and are on the home with its project's thread", () =>
    Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const projects = yield* Projects
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      const tell = (body: string) =>
        Effect.gen(function* () {
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
        })
      // Its first turn is its brief with what was said; the question comes in the next.
      yield* tell('hello')
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      yield* tell(scenarios.question)
      const question = yield* openQuestion(threadId)
      const home = yield* Effect.orDie(queries.home())
      assert.deepStrictEqual(
        home.calls.map((call) => [call.id, call.kind, call.taskId, call.threadId, call.title]),
        [[question.id, 'question', null, threadId, 'Which database?']],
      )
      const listed = yield* Effect.orDie(queries.projects)
      assert.strictEqual(listed.projects.find((one) => one.id === project.projectId)?.coordinatorThreadId, threadId)
      const shownThere = (yield* Effect.orDie(queries.coordinator(project.projectId))).items.filter((item) => item.kind === 'question')
      assert.lengthOf(shownThere, 1)
      assert.deepStrictEqual(yield* answer(question.id, { database: { values: ['postgres'] } }), { told: true })
      yield* until(replies(threadId), (said) => said.includes('answer={"database":"postgres"}'))
    }).pipe(Effect.provide(withQueries())))

  it("are withdrawn when their task is stopped, and every window hears it from the question's item", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tasks = yield* Tasks
      const plans = yield* Plans
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Pick the cache database',
        description: 'Ask which database first. [lead:ask]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      const question = yield* openQuestion(created.threadId)
      const [item] = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE thread_id = ${created.threadId} AND kind = 'question'`
      const heard = () =>
        Effect.map(
          sql<{
            n: number
          }>`SELECT count(*) AS n FROM change_log WHERE aggregate_type = 'thread_item' AND aggregate_id = ${item?.id ?? ''}`,
          ([row]) => row?.n ?? 0,
        )
      const before = yield* heard()
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: created.taskId })
      const [stopped] = yield* until(shown(created.threadId), (rows) => rows[0]?.state === 'withdrawn')
      assert.strictEqual(stopped?.withdrawn, 'task')
      assert.isAbove(yield* heard(), before)
      assert.instanceOf(yield* Effect.flip(answer(question.id, { question_0: { values: ['Postgres'] } })), AttentionClosed)
    }).pipe(Effect.provide(withQueries())))

  it('take a number only as a number', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const { task: created } = yield* task()
      const [row] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${created.taskId}`
      const retries = { id: 'retries', question: 'How many retries?', type: 'number', options: [], multiple: false, required: true }
      yield* sql`INSERT INTO attention_requests ${sql.insert({
        id: 'attn_retries',
        projectId: row?.projectId ?? '',
        taskId: created.taskId,
        kind: 'question',
        addresseeActorId: instance.personId,
        payload: JSON.stringify({
          threadId: created.threadId,
          sessionId: 'gone',
          itemId: 'gone',
          toolCallId: null,
          message: 'One thing.',
          fields: [retries],
        }),
        state: 'open',
        createdAt: new Date().toISOString(),
      })}`
      assert.instanceOf(yield* Effect.flip(answer('attn_retries', { retries: { values: [], words: 'three' } })), QuestionUnanswered)
      const told = yield* answer('attn_retries', { retries: { values: [], words: '3' } })
      assert.deepStrictEqual(told.told ? null : told.body.split('\n').slice(1), ['How many retries? 3'])
    }).pipe(Effect.provide(withQueries())))

  it('say what they ask when they nudge the person', () => {
    const fields = [{ question: 'Which database should the cache use?' }]
    assert.strictEqual(
      callWords({ kind: 'question', payload: { message: 'Please answer.', fields } }, []),
      'Question: Which database should the cache use?',
    )
    assert.strictEqual(
      callWords({ kind: 'question', payload: { message: 'Please answer the following questions.', fields: [...fields, ...fields] } }, []),
      'Question: Which database should the cache use? (and 1 more)',
    )
    assert.strictEqual(
      callWords({ kind: 'question', payload: { message: 'x'.repeat(200), fields: [] } }, []).length,
      'Question: '.length + 140,
    )
    assert.strictEqual(callWords({ kind: 'question', payload: {} }, []), 'Question')
  })
})
