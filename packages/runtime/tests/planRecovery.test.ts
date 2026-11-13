import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { timestamp } from '../src/records'
import { repository, runtime } from './support'

const drafted = (projectId: ProjectId, title: string, reads = false) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    const made = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title,
      draft: true,
      description: 'Work on it. [lead:wait]',
    })
    const planId = yield* (yield* Plans).propose({
      projectId,
      taskId: made.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      held: true,
      ...(reads ? { reads: true } : {}),
    })
    return { ...made, planId }
  })

const project = Effect.gen(function* () {
  const made = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return made.projectId as ProjectId
})

const standing = (planId: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.map(
      sql<{ state: string; startsAt: string | null; decidedAt: string | null; runs: number }>`
      SELECT p.state, p.starts_at, p.decided_at, (SELECT count(*) FROM runs r WHERE r.plan_id = p.id) AS runs
      FROM task_plans p WHERE p.id = ${planId}`,
      ([row]) => row,
    ),
  )

const withRun = (run: (base: Runs['Service']['run']) => Runs['Service']['run']) =>
  Layer.fresh(Plans.layer).pipe(
    Layer.provideMerge(
      Layer.effect(
        Runs,
        Effect.map(Runs, (base) => Runs.of({ ...base, run: run(base.run) })),
      ).pipe(Layer.provideMerge(runtime())),
    ),
  )

describe('an acceptance before its run exists', () => {
  it.live('is held after a failed admission and can be started again without a restart', () => {
    let fail = true
    return Effect.gen(function* () {
      const task = yield* drafted(yield* project, 'Retry admission')
      const plans = yield* Plans
      const instance = yield* Instance
      assert.strictEqual(yield* Effect.flip(plans.start(task.planId, instance.personId)), 'Admission failed')
      assert.deepStrictEqual(yield* standing(task.planId), { state: 'proposed', startsAt: null, decidedAt: null, runs: 0 })
      fail = false
      assert.strictEqual(yield* plans.start(task.planId, instance.personId), 'running')
      assert.strictEqual((yield* standing(task.planId))?.runs, 1)
      assert.isNull(yield* plans.start(task.planId, instance.personId))
      assert.strictEqual((yield* standing(task.planId))?.runs, 1)
    }).pipe(Effect.provide(withRun((base) => (planId) => (fail ? Effect.fail('Admission failed') : base(planId)))))
  })

  it.live('leaves an accepted plan with a persisted run to the run’s own failure handling', () =>
    Effect.gen(function* () {
      const task = yield* drafted(yield* project, 'Already admitted')
      assert.strictEqual(yield* Effect.flip((yield* Plans).start(task.planId, (yield* Instance).personId)), 'After admission')
      const state = yield* standing(task.planId)
      assert.strictEqual(state?.state, 'accepted')
      assert.strictEqual(state?.runs, 1)
    }).pipe(Effect.provide(withRun((base) => (planId) => Effect.andThen(base(planId), Effect.fail('After admission'))))),
  )

  it.live('recovers only open, active-project plans without a run, leaving reviews and settled work alone', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-plan-recovery-')), 'runtime.sqlite')
    return Effect.gen(function* () {
      const kept = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projectId = yield* project
        const recover = yield* drafted(projectId, 'Interrupted acceptance')
        const review = yield* drafted(projectId, 'Review without a run', true)
        const done = yield* drafted(projectId, 'Done')
        const abandoned = yield* drafted(projectId, 'Abandoned')
        const archivedProject = yield* project
        const archived = yield* drafted(archivedProject, 'Archived')
        const running = yield* drafted(projectId, 'Has a run')
        yield* (yield* Plans).start(running.planId, (yield* Instance).personId)
        const at = yield* timestamp
        yield* sql`UPDATE task_plans SET state = 'accepted', starts_at = NULL, decided_at = ${at}`
        yield* sql`UPDATE tasks SET state = 'done', settled_at = ${at} WHERE id = ${done.taskId}`
        yield* sql`UPDATE tasks SET state = 'abandoned', settled_at = ${at} WHERE id = ${abandoned.taskId}`
        yield* sql`UPDATE projects SET archived_at = ${at} WHERE id = ${archivedProject}`
        return { recover, review, done, abandoned, archived, running, at }
      }).pipe(Effect.provide(runtime(file)))
      yield* Effect.gen(function* () {
        assert.deepStrictEqual(yield* standing(kept.recover.planId), { state: 'proposed', startsAt: null, decidedAt: null, runs: 0 })
        for (const task of [kept.review, kept.done, kept.abandoned, kept.archived])
          assert.deepStrictEqual(yield* standing(task.planId), { state: 'accepted', startsAt: null, decidedAt: kept.at, runs: 0 })
        const running = yield* standing(kept.running.planId)
        assert.strictEqual(running?.state, 'accepted')
        assert.strictEqual(running?.runs, 1)
        yield* (yield* Plans).start(kept.recover.planId, (yield* Instance).personId)
        assert.strictEqual((yield* standing(kept.recover.planId))?.runs, 1)
      }).pipe(Effect.provide(runtime(file)))
    })
  })
})
