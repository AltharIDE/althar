import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from '../src/Automations'
import { Instance } from '../src/Instance'
import { missedReports, NO_REPORT } from '../src/missedReports'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * A step whose agent ends its turn without its report, reminded once, and
 * ending again without it: Althar hands the step to the best model free by
 * itself, says so in the thread, and notes which model missed. Only with no
 * other model free, or handed on for this once already in the round, does it
 * need the person. An automation's run goes the same way, never asking.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** A task planned on these steps, as its description says, and started now. */
const planned = (description: string, steps: ReadonlyArray<{ readonly key: 'implement' | 'review'; readonly agentId: string }>) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Retry the checkout',
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return { projectId: project.projectId, task }
  })

/** The task's open call for a step that needs the person: what it says. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
    )
    return JSON.parse(call?.payload ?? '{}') as { step: string; why: string; agentId: string | null; tried?: ReadonlyArray<string> }
  })

/** What the record notes of each step that missed its report: who, and who it was handed to. */
const missed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = ${NO_REPORT} ORDER BY sequence`
  return rows.map((row) => JSON.parse(row.payload) as { agentId: string; step: string; handedTo: string | null })
})

/** What Althar said in the task's thread of a step without its report. */
const saidOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ title: string; about: string | null }>`
      SELECT json_extract(content, '$.title') AS title, json_extract(content, '$.about') AS about FROM thread_items
      WHERE thread_id = ${threadId} AND kind = 'notice' AND json_extract(content, '$.title') LIKE ${'%without a report%'}`
    return rows
  })

describe('a step that ends without its report', () => {
  it.live('is reminded once, then handed to another agent, which finishes it, and nothing asks the person', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task } = yield* planned('Fix the heading. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const [card] = yield* until(Effect.map((yield* Queries).board(projectId), (board) => board.tasks), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(card?.summary, 'Did the task.')
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE kind = 'stuck'`, 0)
      // Reminded once first, naming the tool and what to do without it.
      const prompts = yield* sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at`
      const reminders = prompts.filter((turn) => turn.prompt.startsWith("Your step isn't done until you call Althar's finish_step tool"))
      assert.lengthOf(reminders, 1)
      assert.include(reminders[0]?.prompt, "If finish_step isn't among your tools, say so in a line")
      // Handed on to another agent, which the thread says, as something Althar dealt with.
      const sessions = yield* sql<{ agentId: string }>`
        SELECT agent_id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at, rowid`
      assert.strictEqual(sessions[0]?.agentId, 'claude-code')
      const taker = sessions.at(-1)?.agentId
      assert.notStrictEqual(taker, 'claude-code')
      const [said] = yield* saidOf(task.threadId)
      assert.match(said?.title ?? '', /^.+ ended twice without a report\. .+ takes the work over\.$/)
      assert.strictEqual(said?.about, 'stall')
      // The record notes which model missed, and who took the step: counted for the week.
      assert.deepStrictEqual(
        (yield* missed).map((one) => [one.agentId, one.step, one.handedTo]),
        [['claude-code', 'implement', taker ?? null]],
      )
      const week = yield* missedReports
      assert.deepStrictEqual(
        week.map((one) => [one.agentId, one.count]),
        [['claude-code', 1]],
      )
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { 'claude-code': { noReport: true } } }))),
  )

  it.live('hands a review that ends without its report to another reviewer, away from the lead', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task } = yield* planned('Fix the heading. [lead:finish] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      yield* until(Effect.map((yield* Queries).board(projectId), (board) => board.tasks), (cards) => cards[0]?.phase === 'ready')
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE kind = 'stuck'`, 0)
      const reviewers = yield* sql<{ agentId: string }>`
        SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND t.node_key = 'review' ORDER BY s.started_at, s.rowid`
      assert.deepStrictEqual(
        reviewers.map((one) => one.agentId),
        ['codex', 'opencode'],
      )
      const [said] = yield* saidOf(task.threadId)
      assert.match(said?.title ?? '', /takes the review over\.$/)
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { codex: { noReport: true } } }))),
  )

  it.live('needs the person, as before, where no other model is free', () =>
    Effect.gen(function* () {
      const { task } = yield* planned('Fix the heading. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId, call.tried], ['implement', 'no_report', 'claude-code', undefined])
      assert.deepStrictEqual(
        (yield* missed).map((one) => [one.agentId, one.handedTo]),
        [['claude-code', null]],
      )
      assert.lengthOf(yield* saidOf(task.threadId), 0)
    }).pipe(
      Effect.provide(
        withQueries(
          ':memory:',
          {},
          {
            signedOut: ['codex', 'opencode'],
            each: { 'claude-code': { noReport: true, models: [{ id: 'small', name: 'Small' }] } },
          },
        ),
      ),
    ),
  )

  it.live('needs the person once the model it was handed to ends without its report too: handed on once a round', () =>
    Effect.gen(function* () {
      const { task } = yield* planned('Fix the heading. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const call = yield* stuckCall(task.taskId)
      assert.strictEqual(call.why, 'no_report')
      assert.deepStrictEqual(call.tried, ['handed_on'])
      const notes = yield* missed
      assert.lengthOf(notes, 2)
      assert.strictEqual(notes[0]?.agentId, 'claude-code')
      assert.isNotNull(notes[0]?.handedTo)
      assert.strictEqual(notes[1]?.agentId, notes[0]?.handedTo)
      assert.isNull(notes[1]?.handedTo)
    }).pipe(
      Effect.provide(
        withQueries(
          ':memory:',
          {},
          { each: { 'claude-code': { noReport: true }, codex: { noReport: true }, opencode: { noReport: true } } },
        ),
      ),
    ),
  )

  it.live("hands an automation's run on by itself, and never asks the person", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const automations = yield* Automations
      const instance = yield* Instance
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const automationId = yield* automations.make({
        projectId: project.projectId as ProjectId,
        definition: {
          name: 'Nightly dependency check',
          prompt: 'Check the dependencies. [lead:finish]',
          schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '03:00' },
          zone: 'Europe/London',
          lead: { agentId: 'codex', model: null },
          work: { kind: 'task', review: null, end: null },
          allowEverything: true,
          minutes: 45,
          late: 'once',
        },
        on: true,
        actorId: instance.personId,
      })
      yield* automations.runNow(automationId, instance.personId)
      const [ran] = yield* until(
        sql<{ state: string; taskId: string | null }>`SELECT state, task_id FROM automation_occurrences WHERE automation_id = ${automationId}`,
        (rows) => rows[0]?.state === 'made',
      )
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${ran?.taskId ?? ''} AND kind = 'task'`
      const [said] = yield* saidOf(thread?.id ?? '')
      assert.match(said?.title ?? '', /ended twice without a report/)
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
      assert.deepStrictEqual(
        (yield* missed).map((one) => one.agentId),
        ['codex'],
      )
    }).pipe(
      Effect.provide(
        withQueries(
          ':memory:',
          {},
          {
            each: { codex: { noReport: true } },
            automations: { zone: () => 'Europe/London', tick: Duration.millis(100), settle: Duration.zero, stagger: false },
          },
        ),
      ),
    ),
  )
})
