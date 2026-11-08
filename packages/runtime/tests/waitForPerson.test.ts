import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, toolDescriptions, until, withWork } from './support'

/*
 * A lead that can't go on without the person ends its turn waiting, rather
 * than reporting its step done: the task waits in Needs you with its question,
 * no review runs, and the person's answer starts the lead again.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** A task planned on these steps, as its description says, and started now. */
const planned = (description: string) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Compact the ADRs',
      description: withWork(description, true),
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return { projectId: project.projectId as ProjectId, ...task }
  })

/** The task's open call for a step that needs the person: its id and what it says. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
    )
    return { id: call?.id ?? '', ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string; detail: string | null }) }
  })

/** The steps the task's plan has admitted, and where each stands. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string }>`
      SELECT n.node_key AS step, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** The task as its card and thread read it. */
const phaseOf = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const board = yield* queries.board(projectId)
    return board.tasks.find((task) => task.taskId === taskId)?.phase
  })

describe('a lead waiting on the person', () => {
  it.live('ends its turn waiting, with its question, and no review; the answer starts it again', () => {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned('Ask first. [lead:wait-for-person] [lead:finish] [lead:edit] [review:pass]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual(
        [call.step, call.why, call.detail],
        ['implement', 'waiting_on_person', 'Which ADRs should the compaction keep?'],
      )
      // The task waits on the person, with its question, and no review has started.
      assert.strictEqual(yield* phaseOf(task.projectId, task.taskId), 'waiting')
      assert.deepStrictEqual(yield* attempts(task.taskId), [{ step: 'implement', state: 'waiting_attention' }])
      assert.lengthOf(yield* sql`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step'`, 0)
      // A step waiting on the person isn't done: finish_step refuses.
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const lead: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      assert.match(
        yield* callTool(lead, 'finish_step', { summary: 'Waiting for the person’s answers before writing anything. No files changed.' }),
        /waiting on the person’s answer/i,
      )
      // Their answer starts the lead again, which finishes, and the review follows.
      yield* (yield* Runs).answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call.id,
        answer: { kind: 'tell', note: 'Keep the dozen current-state decisions.' },
      })
      yield* until(
        Effect.map(attempts(task.taskId), (rows) => rows.filter((row) => row.step === 'review')),
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual(
        (yield* attempts(task.taskId)).map((row) => row.step),
        ['implement', 'review'],
      )
      yield* until(phaseOf(task.projectId, task.taskId), (phase) => phase === 'ready')
      assert.include(
        (yield* sql<{ prompt: string | null }>`
          SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at DESC LIMIT 1`)[0]?.prompt ?? '',
        'Keep the dozen current-state decisions.',
      )
    }).pipe(Effect.provide(withQueries()))
  })

  it.live('is answered by the person writing in the thread, which starts the lead again', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned('Ask first. [lead:wait-for-person] [lead:finish] [lead:edit] [review:pass]')
      const call = yield* stuckCall(task.taskId)
      // The person writes in the task's thread, rather than answering its card.
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId }),
        threadId: task.threadId,
        body: 'Keep the dozen current-state decisions.',
      })
      // Their words close the call and start the lead again, which finishes and is reviewed.
      yield* until(
        Effect.map(attempts(task.taskId), (rows) => rows.filter((row) => row.step === 'review')),
        (rows) => rows.length === 1,
      )
      const [answered] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${call.id}`
      assert.strictEqual(answered?.state, 'answered')
      yield* until(phaseOf(task.projectId, task.taskId), (phase) => phase === 'ready')
      assert.include(
        (yield* sql<{ prompt: string | null }>`
          SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at DESC LIMIT 1`)[0]?.prompt ?? '',
        'Keep the dozen current-state decisions.',
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says the review stopped when it is skipped, rather than vanishing', () =>
    Effect.gen(function* () {
      const task = yield* planned('Build it. [lead:finish] [lead:edit] [review:wait]')
      yield* until(
        Effect.map(attempts(task.taskId), (rows) => rows.filter((row) => row.step === 'review')),
        (rows) => rows.length === 1,
      )
      yield* (yield* Runs).skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: task.taskId })
      const said = yield* until(notices(task.threadId), (all) => all.some((notice) => notice.title?.includes('review stopped') === true))
      assert.include(
        said.map((notice) => notice.title),
        'The review stopped: skipped, with what it found left open.',
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says the review stopped when the person interrupts it, rather than vanishing', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned('Build it. [lead:finish] [lead:edit] [review:wait]')
      yield* until(
        Effect.map(attempts(task.taskId), (rows) => rows.filter((row) => row.step === 'review')),
        (rows) => rows.length === 1,
      )
      const [thread] = yield* until(
        sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step' AND node_key = 'review'`,
        (rows) => rows.length === 1,
      )
      const sessions = yield* Sessions
      yield* until(
        Effect.map(sessions.running(thread?.id ?? ''), (running) => Option.exists(running, (one) => one.turnRunning)),
        (running) => running,
      )
      yield* sessions.interrupt(thread?.id ?? '')
      const said = yield* until(notices(task.threadId), (all) =>
        all.some((notice) => notice.title?.includes('The review stopped: you interrupted it') === true),
      )
      assert.include(
        said.map((notice) => notice.title),
        'The review stopped: you interrupted it. It waits for you to start it again.',
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('runs no review when it built nothing', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned('Look, and say. [lead:finish] [lead:nothing] [review:pass]')
      yield* until(phaseOf(task.projectId, task.taskId), (phase) => phase === 'ready')
      assert.deepStrictEqual(yield* attempts(task.taskId), [{ step: 'implement', state: 'succeeded' }])
      assert.lengthOf(yield* sql`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step'`, 0)
      assert.lengthOf(yield* sql`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review'`, 0)
      // The person settles it with Done: it is finished, not merged.
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const lead: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      assert.isTrue(
        yield* (yield* Tasks).markDone({
          envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.taskId }),
          taskId: task.taskId,
        }),
      )
      const listed = yield* callTool(lead, 'list_tasks')
      assert.include(listed, `${task.slug}: Compact the ADRs (finished, led by`)
      assert.notInclude(listed, `${task.slug}: Compact the ADRs (finished, merged`)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is told to wait rather than finish, in its tools and its brief', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* planned('Ask first. [lead:wait-for-person]')
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const lead: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      const described = yield* toolDescriptions(lead)
      assert.match(described['finish_step'] ?? '', /Don't call it while the work isn't done because it waits on the person/)
      assert.match(described['wait_for_person'] ?? '', /Ends your turn waiting on the person's answer/)
      assert.include(
        (yield* sql<{ prompt: string | null }>`
          SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at LIMIT 1`)[0]?.prompt ?? '',
        'call wait_for_person with your question',
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
