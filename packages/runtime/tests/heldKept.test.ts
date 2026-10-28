import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { planWaits, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { repository, runtime, until } from './support'

/*
 * Held steps as the store keeps them, read back however an earlier Althar
 * wrote them (placesKept.test.ts has the person's places): a review waiting
 * for a place with no reviewer named, a step waiting whose record can't be
 * read, and steps held for a usage limit before Althar kept the account and
 * model, or whose hold can't be read at all.
 */

const GB = 1024 ** 3
const HOUR = 60 * 60 * 1000

/** The runtime on a machine that runs one agent at once, with the options given. */
const oneAtOnce = (more: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } }, ...more })))

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

/** A task planned on these steps, as its description says, started now. */
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

const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; step: string; state: string; holdReason: string | null; output: string | null }>`
      SELECT a.id, n.node_key AS step, a.state, a.hold_reason, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** The task's latest step, once it is held for this reason. */
const heldFor = (taskId: string, reason: 'machine_busy' | 'usage_limit') =>
  Effect.map(
    until(attempts(taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === reason, Duration.seconds(15)),
    (rows) => rows.at(-1) ?? { id: '', step: '', state: '', holdReason: null, output: null },
  )

/**
 * A reviewer out of usage until a reset some seconds after it first says so: after the other task's lead takes the one
 * place, at once, and before that lead stops working, five seconds in. A reset fixed from the test's start may fall either
 * side on a busy machine.
 */
const outUntilSoon = () => {
  let until: number | undefined
  return {
    get until() {
      return (until ??= Date.now() + 2_500)
    },
  }
}

/**
 * The task's review, once it waits for a place behind another task: its reviewer is out of usage until its reset, another
 * task's lead takes the one place meanwhile, and at the reset there is none. The other task, and the review waiting.
 */
const reviewBehind = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    yield* until(attempts(taskId), (rows) => rows.at(-1)?.holdReason === 'usage_limit', Duration.seconds(15))
    const other = yield* started(projectId, 'Hold the place', 'Work on it. [lead:wait]', [{ key: 'implement', agentId: 'opencode' }])
    yield* until(attempts(other.taskId), (rows) => rows.at(-1)?.state === 'running', Duration.seconds(15))
    return { other, review: yield* heldFor(taskId, 'machine_busy') }
  })

const readyIs = (projectId: string, taskId: string) =>
  until(
    Effect.gen(function* () {
      const queries = yield* Queries
      const board = yield* Effect.orDie(queries.board(projectId))
      return board.tasks.filter((task) => task.taskId === taskId && task.phase === 'ready')
    }),
    (rows) => rows.length === 1,
    Duration.seconds(30),
  )

const ranOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      agentId: string
    }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
    return [...new Set(rows.map((row) => row.agentId))]
  })

describe('a step waiting for a place, as an earlier Althar kept it', () => {
  it.live('starts a review kept with no reviewer named on the plan’s reviewer, once there is a place', () =>
    Effect.gen(function* () {
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
      const { other, review } = yield* reviewBehind(projectId, task.taskId)
      // Kept as the step after its lead's, with no reviewer named.
      const { since } = JSON.parse(review.output ?? '{}') as { since?: string }
      yield* sql`UPDATE node_attempts SET output = ${JSON.stringify({ place: { how: 'next' }, since })} WHERE id = ${review.id}`
      // The other's lead finishes: the review takes the place, on the plan's reviewer.
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: other.threadId, body: '[lead:finish]' })
      yield* readyIs(projectId, task.taskId)
      const [reviewer] = yield* sql<{ agentId: string }>`
        SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.task_id = ${task.taskId} AND t.kind = 'step'`
      assert.strictEqual(reviewer?.agentId, 'codex')
    }).pipe(Effect.provide(oneAtOnce({ each: { codex: { outOfUsage: outUntilSoon() } } }))),
  )

  it.live('starts a review kept as resumed with no reviewer named at once, on the plan’s reviewer', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Reviewed', 'Do it. [lead:finish] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      const { review } = yield* reviewBehind(projectId, task.taskId)
      const { since } = JSON.parse(review.output ?? '{}') as { since?: string }
      yield* sql`UPDATE node_attempts SET output = ${JSON.stringify({
        place: { how: 'resume', lead: { agentId: 'claude-code', model: null, effort: null } },
        since,
      })} WHERE id = ${review.id}`
      yield* readyIs(projectId, task.taskId)
    }).pipe(Effect.provide(oneAtOnce({ each: { codex: { outOfUsage: outUntilSoon() } } }))),
  )

  it.live('carries on one whose record can’t be read as after a restart, once there is a place, and its plan can’t be changed', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const projectId = yield* opened
      const holding = yield* started(projectId, 'Hold the place', 'Work on it. [lead:wait]', [{ key: 'implement', agentId: 'opencode' }])
      const task = yield* started(projectId, 'Waits', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const waiting = yield* heldFor(task.taskId, 'machine_busy')
      assert.isTrue(yield* planWaits(task.taskId))
      yield* sql`UPDATE node_attempts SET output = NULL WHERE id = ${waiting.id}`
      assert.isFalse(yield* planWaits(task.taskId))
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: holding.threadId, body: '[lead:finish]' })
      yield* readyIs(projectId, task.taskId)
      assert.deepStrictEqual(yield* ranOn(task.threadId), ['claude-code'])
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('a step held for a usage limit, as an earlier Althar kept it', () => {
  it.live('carries on at its reset, as its agent picks, where its hold names no account or model', () => {
    const back = Date.now() + 3_000
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Out', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const held = yield* heldFor(task.taskId, 'usage_limit')
      yield* sql`UPDATE node_attempts SET output = json_remove(output, '$.account', '$.model') WHERE id = ${held.id}`
      yield* readyIs(projectId, task.taskId)
      assert.deepStrictEqual(yield* ranOn(task.threadId), ['claude-code'])
    }).pipe(Effect.provide(oneAtOnce({ each: { 'claude-code': { outOfUsage: { until: back } } } })))
  })

  it.live('is handed on as the person picks, though its hold can’t be read', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Out long', 'Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }])
      const held = yield* heldFor(task.taskId, 'usage_limit')
      yield* sql`UPDATE node_attempts SET output = NULL WHERE id = ${held.id}`
      yield* runs.handOverHeld({
        envelope: yield* Runtime.envelope('task.hand_over_held', {}),
        taskId: task.taskId,
        answer: { kind: 'retry', agentId: 'codex' },
      })
      yield* readyIs(projectId, task.taskId)
      assert.deepStrictEqual(yield* ranOn(task.threadId), ['claude-code', 'codex'])
    }).pipe(Effect.provide(oneAtOnce({ each: { 'claude-code': { outOfUsage: { until: back } } } })))
  })
})
