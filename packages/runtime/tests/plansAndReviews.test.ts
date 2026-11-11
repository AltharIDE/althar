import { PLANS_AND_REVIEWS, NEW_PROJECT_DEFAULTS } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { plansAndReviewsOf, roundsOutNow, newProjectDefaultsOf, setPlansAndReviews, setNewProjectDefaults } from '../src/plansAndReviews'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * The settings for how long work goes on alone, and for what the rules of a
 * project made from now on start with: today's values until changed, kept
 * only once they differ, and read where they apply.
 */

const settings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return (yield* sql<{ key: string; value: string }>`SELECT key, value FROM settings ORDER BY key`).map((row) => [row.key, row.value])
})

describe('how long work goes on alone', () => {
  it.effect('is today’s values until the person changes one, and keeps a row only for what differs', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* plansAndReviewsOf, PLANS_AND_REVIEWS)
      yield* setPlansAndReviews({ countdown: 10, rounds: 2 })
      assert.deepStrictEqual(yield* plansAndReviewsOf, { ...PLANS_AND_REVIEWS, countdown: 10, rounds: 2 })
      assert.deepStrictEqual(yield* settings, [
        ['plan_countdown_seconds', '10'],
        ['review_rounds', '2'],
      ])
      // Back at today's value, it is no setting at all; what wasn't given stays.
      yield* setPlansAndReviews({ countdown: 25 })
      assert.deepStrictEqual(yield* settings, [['review_rounds', '2']])
      yield* setPlansAndReviews({ countdown: 60 })
      assert.deepStrictEqual(yield* plansAndReviewsOf, { countdown: 60, rounds: 2, roundsOut: 'settled' })
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('keeps what happens when rounds run out, read live, a row only when it differs', () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* plansAndReviewsOf).roundsOut, 'settled')
      yield* setPlansAndReviews({ roundsOut: 'ask' })
      assert.strictEqual(yield* roundsOutNow, 'ask')
      assert.deepStrictEqual(yield* settings, [['review_rounds_out', 'ask']])
      yield* setPlansAndReviews({ roundsOut: 'settled' })
      assert.deepStrictEqual(yield* settings, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('reads a value that is no choice as today’s', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO settings (key, value, updated_at) VALUES ('review_rounds', '9', '2026-10-31T10:00:00.000Z'), ('review_rounds_out', 'always', '2026-10-31T10:00:00.000Z'), ('plan_countdown_seconds', 'soon', '2026-10-31T10:00:00.000Z')`
      assert.deepStrictEqual(yield* plansAndReviewsOf, PLANS_AND_REVIEWS)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('starts a plan after the countdown the person set, and the next after another', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const proposed = (title: string) =>
        Effect.gen(function* () {
          const task = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title,
            draft: true,
          })
          const planId = yield* plans.propose({
            projectId: project.projectId as ProjectId,
            taskId: task.taskId,
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
            reason: null,
            actorId: instance.personId,
            held: false,
          })
          const [row] = yield* sql<{ wait: number }>`
            SELECT round((julianday(starts_at) - julianday(proposed_at)) * 86400) AS wait FROM task_plans WHERE id = ${planId}`
          return row?.wait
        })
      assert.strictEqual(yield* proposed('Today'), 25)
      yield* setPlansAndReviews({ countdown: 10 })
      assert.strictEqual(yield* proposed('Shorter'), 10)
      yield* setPlansAndReviews({ countdown: 60 })
      assert.strictEqual(yield* proposed('Longer'), 60)
    }).pipe(Effect.provide(runtime(undefined, {}, { countdown: null }))),
  )
})

describe('the plan card', () => {
  it.live('says how long its countdown was, so the card draws it whole', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const queries = yield* Queries
      yield* setPlansAndReviews({ countdown: 10 })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Shorter',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
      })
      const snapshot = yield* Effect.orDie(queries.coordinator(project.projectId))
      const cards = snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
      assert.strictEqual(cards[0]?.plan?.startsAfter, 10)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(undefined, {}, { countdown: null }))))),
  )
})

describe('the rules a new project starts with', () => {
  const rulesOf = (projectId: string) =>
    Effect.gen(function* () {
      const policies = yield* Policies
      return (yield* policies.current(projectId as ProjectId)).rules
    })

  it.effect('are the built-in rules until the person chooses', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* newProjectDefaultsOf, NEW_PROJECT_DEFAULTS)
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      assert.deepStrictEqual(yield* rulesOf(project.projectId), {
        source: 'mvp',
        alwaysAsk: [...(yield* rulesOf(project.projectId)).alwaysAsk],
        // Everything is allowed but what can't be undone, from the start (ADR-097).
        allowEverything: true,
      })
      assert.strictEqual((yield* rulesOf(project.projectId)).permissions, undefined)
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('start a project made after they change, and leave one made before', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const before = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      // Its rules exist from the moment it is made, whenever they are first read.
      yield* setNewProjectDefaults({
        usageLimit: 'wait',
        rotateAccounts: true,
        end: 'ready',
        pushCommits: false,
        postScreenshots: true,
        resolveConflicts: false,
        moveIssues: false,
      })
      const after = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const made = yield* rulesOf(after.projectId)
      assert.deepStrictEqual(
        [
          made.source,
          made.usageLimit,
          made.accounts?.rotate,
          made.end,
          made.pushCommits,
          made.postScreenshots,
          made.resolveConflicts,
          made.moveIssues,
        ],
        ['defaults', 'wait', true, 'ready', false, true, false, false],
      )
      const earlier = yield* rulesOf(before.projectId)
      assert.deepStrictEqual(
        [earlier.source, earlier.usageLimit, earlier.accounts, earlier.end, earlier.pushCommits, earlier.postScreenshots],
        ['mvp', undefined, undefined, undefined, undefined, undefined],
      )
      // And what the person changes in the project afterwards is the project's own, whatever the defaults say.
      yield* setNewProjectDefaults({ usageLimit: 'ask' })
      assert.strictEqual((yield* rulesOf(after.projectId)).usageLimit, 'wait')
      // A switch put back to what it is without one is forgotten, so a profile that chose nothing makes the same rules as always.
      yield* setNewProjectDefaults({ pushCommits: true, postScreenshots: false, resolveConflicts: true, moveIssues: true })
      const defaults = yield* newProjectDefaultsOf
      assert.deepStrictEqual(
        [defaults.pushCommits, defaults.postScreenshots, defaults.resolveConflicts, defaults.moveIssues],
        [true, false, true, true],
      )
    }).pipe(Effect.provide(runtime())),
  )
})
