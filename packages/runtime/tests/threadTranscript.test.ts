import type { QuestionField } from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { SqlClient } from 'effect/sql'

import { Questions } from '../src/Questions'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { addItem, transcript } from '../src/threads'
import { runtime, task, turns, until } from './support'

/*
 * A thread as text, for an agent that takes it over or the coordinator that
 * reads it: what was asked of the person and what became of it, what the
 * lead asked to push, and cards whose drafts have gone, which say nothing.
 */

const field = (id: string, question: string): QuestionField => ({
  id,
  question,
  type: 'choice',
  options: [
    { value: 'sqlite', label: 'SQLite' },
    { value: 'redis', label: 'Redis' },
  ],
  multiple: false,
  required: true,
})

describe('a thread as text', () => {
  it.live('says what was asked of the person, what they answered, what wasn’t, and what still waits', () =>
    Effect.gen(function* () {
      const questions = yield* Questions
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(
        turns(created.threadId),
        (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
      )
      const context = { projectId: project.projectId as ProjectId, threadId: created.threadId, taskId: created.taskId, sessionId }
      const opened = (n: number) =>
        until(
          sql<{ id: string }>`SELECT id FROM attention_requests WHERE kind = 'question' ORDER BY created_at, rowid`,
          (rows) => rows.length === n,
        )

      // Answered.
      const first = yield* Effect.forkChild(
        questions.ask(context, { message: 'One thing.', fields: [field('database', 'Which database?')] }),
      )
      const [asked] = yield* opened(1)
      yield* questions.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: asked?.id ?? '',
        answers: { database: { values: ['redis'] } },
      })
      yield* Fiber.join(first)
      // Taken back before the person answered.
      const second = yield* Effect.forkChild(questions.ask(context, { message: 'Another.', fields: [field('cache', 'Which cache?')] }))
      yield* opened(2)
      yield* Fiber.interrupt(second)
      // Still waiting on the person, asked in the agent's own words.
      const third = yield* Effect.forkChild(questions.ask(context, { message: 'Shall I go on?', fields: [field('go', '')] }))
      yield* opened(3)
      // A question from before calls kept what was asked, and drafts that have gone since.
      const place = { projectId: project.projectId as ProjectId, threadId: created.threadId }
      yield* addItem(place, 'question', { attentionId: 'att_gone', message: 'Which region?' })
      yield* addItem(place, 'issue_draft', { draftId: 'idr_gone' })
      yield* addItem(place, 'review_draft', { draftId: 'rdr_gone' })
      yield* addItem(place, 'push_request', { where: 'PR #12' })

      const { text } = yield* transcript(created.threadId, 30_000, { agent: 'lead' })
      const lines = text.split('\n')
      assert.includeMembers(lines, [
        '[lead asked the person] Which database?',
        '[person answered] Which database? Redis',
        '[lead asked the person] Which cache?',
        '[not answered]',
        '[lead asked the person] Shall I go on?',
        '[lead asked the person] Which region?',
        '[the lead asked the person to push] 0 commits to PR #12: not pushed yet',
      ])
      assert.notInclude(text, '[issue draft]')
      assert.notInclude(text, '[review draft]')
      // The one still waiting says nothing more.
      assert.strictEqual(lines[lines.indexOf('[lead asked the person] Shall I go on?') + 1], '[lead asked the person] Which region?')
      yield* Fiber.interrupt(third)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a task’s course, where there is nothing to do', () => {
  it.live('leaves out nothing of a task with nothing to leave out, and brings back no task that isn’t there', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const facts = sql<{ type: string }>`SELECT type FROM record_events WHERE aggregate_id = ${created.taskId} ORDER BY sequence`
      const before = yield* facts
      yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', { taskId: created.taskId }), taskId: created.taskId })
      assert.deepStrictEqual(yield* facts, before)
      // Nothing is there to bring back: nothing is recorded, and nothing fails.
      const all = sql<{ n: number }>`SELECT count(*) AS n FROM record_events`
      const was = yield* all
      yield* tasks.bringBack('task_gone')
      assert.deepStrictEqual(yield* all, was)
    }).pipe(Effect.provide(runtime())),
  )
})
