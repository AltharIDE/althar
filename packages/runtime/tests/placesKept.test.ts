import type { ActorId, ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { whenWords } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { atReset, later, onTestClock, repository, runtime, until } from './support'

/*
 * Steps that waited for a place among the agents at work (Busy.ts), as they
 * start once they have one, where busy.test.ts doesn't go: one an earlier
 * Althar kept waiting as the person resumed or answered it, which starts at
 * once now, as what the person did never waits; and one whose usage limit
 * reset while every place was taken.
 */

const GB = 1024 ** 3

/** The runtime on a machine that runs one agent at once, with agents as given. */
const oneAtOnce = (each: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } }, ...each })))

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A task planned on these steps, as its description says, started now: its ids. */
const started = (
  projectId: ProjectId,
  title: string,
  description: string,
  steps: ReadonlyArray<{ readonly key: 'implement' | 'review'; readonly agentId: string }>,
) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const actor = yield* person
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    yield* plans.start(planId, actor)
    return created
  })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

/** The task's step attempts, oldest first. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; step: string; state: string; holdReason: string | null; output: string | null }>`
      SELECT a.id, n.node_key AS step, a.state, a.hold_reason, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** The task's latest step, once it waits for a place. */
const waitingStep = (taskId: string) =>
  Effect.map(
    until(attempts(taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === 'machine_busy'),
    (rows) => rows.at(-1) ?? { id: '', step: '', state: '', holdReason: null, output: null },
  )

/**
 * The task's review, once it waits for a place behind another task: its reviewer is out of usage until its reset, another
 * task's lead takes the one place meanwhile, and at the reset there is none. The other task, and the review waiting.
 */
const reviewBehind = (projectId: ProjectId, taskId: string, back: number) =>
  Effect.gen(function* () {
    yield* until(attempts(taskId), (rows) => rows.at(-1)?.holdReason === 'usage_limit')
    const other = yield* started(projectId, 'Hold the place', 'Work on it. [lead:wait]', [{ key: 'implement', agentId: 'opencode' }])
    yield* until(attempts(other.taskId), (rows) => rows.at(-1)?.state === 'running')
    // The reset comes once the other has the place.
    yield* atReset(back)
    return { other, review: yield* waitingStep(taskId) }
  })

/** What a step waiting for a place keeps, as an earlier Althar kept it: how it starts, since when it waited. */
const keptAs = (attemptId: string, output: string | null, place: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { since } = JSON.parse(output ?? '{}') as { since?: string }
    yield* sql`UPDATE node_attempts SET output = ${JSON.stringify({ place, since })} WHERE id = ${attemptId}`
  })

const phaseOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const board = yield* Effect.orDie(queries.board(projectId))
    return board.tasks.find((task) => task.taskId === taskId)?.phase
  })

const readyIs = (projectId: string, taskId: string) =>
  until(
    Effect.map(phaseOf(projectId, taskId), (phase) => (phase === 'ready' ? [phase] : [])),
    (rows) => rows.length === 1,
  )

describe('a step an earlier Althar kept waiting for a place as the person resumed it', () => {
  it.effect('starts a review at once on the reviewer it was resumed on, though every place is taken', () => {
    const back = later()
    return Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Reviewed', 'Do it. [lead:finish] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      const { other, review } = yield* reviewBehind(projectId, task.taskId, back)
      assert.strictEqual(review.step, 'review')
      yield* keptAs(review.id, review.output, {
        how: 'resume',
        lead: { agentId: 'claude-code', model: null, effort: null },
        reviewer: { key: 'review', agentId: 'codex', model: null, skipped: false },
      })
      yield* readyIs(projectId, task.taskId)
      // The other never finished: the review went on all the same, as the person's.
      assert.notStrictEqual((yield* attempts(other.taskId)).at(-1)?.state, 'succeeded')
      const [reviewed] = (yield* attempts(task.taskId)).filter((row) => row.step === 'review')
      assert.strictEqual(reviewed?.state, 'succeeded')
    }).pipe(Effect.provide(oneAtOnce({ each: { codex: { outOfUsage: { until: back } } } })), onTestClock)
  })

  it.live("carries a lead's step on at once on the lead it was resumed on, or as answered", () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      // One task's lead holds the only place.
      yield* started(projectId, 'Hold the place', 'Work on it. [lead:wait]', [{ key: 'implement', agentId: 'opencode' }])
      const resumed = yield* started(projectId, 'Resumed', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const answered = yield* started(projectId, 'Answered', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const first = yield* waitingStep(resumed.taskId)
      const second = yield* waitingStep(answered.taskId)
      yield* keptAs(first.id, first.output, { how: 'resume', lead: { agentId: 'codex', model: null, effort: null } })
      yield* keptAs(second.id, second.output, {
        how: 'answered',
        info: { step: 'implement', why: 'stalled', detail: null, agentId: 'claude-code', round: 0, open: 0 },
        answer: { kind: 'retry', agentId: 'codex' },
      })
      yield* readyIs(projectId, resumed.taskId)
      yield* readyIs(projectId, answered.taskId)
      const sql = yield* SqlClient.SqlClient
      const leads = yield* sql<{ title: string; agentId: string }>`
        SELECT k.title, s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id JOIN tasks k ON k.id = t.task_id
        WHERE k.title IN ('Resumed', 'Answered') ORDER BY k.title`
      assert.deepStrictEqual(
        leads.map((row) => [row.title, row.agentId]),
        [
          ['Answered', 'codex'],
          ['Resumed', 'codex'],
        ],
      )
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('a step whose usage limit resets while every place is taken', () => {
  it.effect('waits for a place, then carries on, on the agent it was held for', () => {
    const back = later()
    // OpenCode's lead keeps the place until the test lets its turn end.
    const place = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Out', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.holdReason === 'usage_limit')
      // Held for its reset, it takes no place: another task's lead takes the one there is.
      const other = yield* started(projectId, 'Hold the place', 'Work on it. [lead:wait]', [{ key: 'implement', agentId: 'opencode' }])
      yield* until(attempts(other.taskId), (rows) => rows.at(-1)?.state === 'running')
      // At its reset, there is no place: it waits for one.
      yield* atReset(back)
      yield* waitingStep(task.taskId)
      // The place frees: it carries on, on Claude Code.
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: other.threadId, body: '[lead:finish]' })
      place.open('[lead:wait]')
      yield* readyIs(projectId, task.taskId)
      const sql = yield* SqlClient.SqlClient
      const ran = yield* sql<{ agentId: string }>`
        SELECT agent_id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at, rowid`
      assert.deepStrictEqual([...new Set(ran.map((row) => row.agentId))], ['claude-code'])
    }).pipe(
      Effect.provide(oneAtOnce({ each: { 'claude-code': { outOfUsage: { until: back } }, opencode: { holds: place } } })),
      onTestClock,
    )
  })
})

describe('a review that waited for a place while its reviewer fell nearly out', () => {
  it.effect('goes by the project’s rule, as a review starting at once would: held until the reset, where it waits', () => {
    const back = later()
    // OpenCode's lead keeps the place until the test lets its turn end.
    const place = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Reviewed', 'Do it. [lead:finish] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      // Its review waits for a place behind another task, kept as an earlier Althar kept a review after its lead's.
      const { other, review } = yield* reviewBehind(projectId, task.taskId, back)
      assert.strictEqual(review.step, 'review')
      yield* keptAs(review.id, review.output, { how: 'next', reviewer: { key: 'review', agentId: 'codex', model: null, skipped: false } })
      // Meanwhile Codex falls to 3%.
      const [codex] = yield* (yield* Accounts).of('codex')
      const resetsAt = new Date(Math.ceil(((yield* Clock.currentTimeMillis) + 3_600_000) / 1000) * 1000).toISOString()
      yield* sql`INSERT INTO plan_usage_readings ${sql.insert({
        accountId: codex?.id ?? '',
        agentId: 'codex',
        source: 'agent',
        plan: null,
        windows: JSON.stringify([{ kind: 'five_hour', usedPercent: 97, resetsAt }]),
        observedAt: new Date().toISOString(),
      })}`
      // The other task finishes: the place frees, and the review is held for Codex's reset, as the project waits.
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: other.threadId, body: '[lead:finish]' })
      place.open('[lead:wait]')
      const held = (yield* until(
        attempts(task.taskId),
        (rows) =>
          rows.at(-1)?.holdReason === 'usage_limit' && (JSON.parse(rows.at(-1)?.output ?? '{}') as { until?: string }).until === resetsAt,
      )).at(-1)
      assert.strictEqual(held?.step, 'review')
      const notices = yield* sql<{ title: string }>`
        SELECT json_extract(content, '$.title') AS title FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'notice'`
      assert.include(
        notices.map((row) => row.title),
        `Fake codex has 3% of its five-hour limit left, so the review waits until ${whenWords(resetsAt, yield* Clock.currentTimeMillis)}. To carry on now, pick another model on the task.`,
      )
    }).pipe(Effect.provide(oneAtOnce({ each: { codex: { outOfUsage: { until: back } }, opencode: { holds: place } } })), onTestClock)
  })
})
