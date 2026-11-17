import type { PlanStep } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { isoAfter } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { change, fact, timestamp } from '../src/records'
import { Sessions } from '../src/Sessions'
import { teamLeadOf } from '../src/teamLead'
import { repository, runtime, until } from './support'

const lead: PlanStep = { key: 'implement', agentId: 'claude-code', model: 'small', effort: 'high', skipped: false }
const review: PlanStep = { key: 'review', agentId: 'codex', model: 'large', effort: 'high', skipped: false }

const started = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const made = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Keep the team current',
    description: '',
    draft: true,
  })
  const instance = yield* Instance
  const plans = yield* Plans
  const planId = yield* plans.propose({
    projectId: project.projectId as ProjectId,
    taskId: made.taskId,
    steps: [lead, review],
    reason: null,
    actorId: instance.personId,
    held: true,
    end: 'none',
  })
  const sql = yield* SqlClient.SqlClient
  // Isolate the saved team and its conversation from a workflow controller's missing-report fallback.
  yield* sql`UPDATE task_plans SET state = 'accepted', starts_at = NULL, decided_at = proposed_at WHERE id = ${planId}`
  yield* (yield* Sessions).start({ threadId: made.threadId, agentId: lead.agentId, model: lead.model!, effort: lead.effort! })
  yield* until(
    (yield* Sessions).running(made.threadId),
    (session) => Option.isSome(session) && session.value.turnEndedAt !== null && !session.value.turnRunning,
  )
  return { ...made, projectId: project.projectId, planId }
})

const projected = (projectId: string, taskId: string, threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const board = yield* queries.board(projectId)
    const coordinator = yield* queries.coordinator(projectId)
    const thread = yield* queries.thread(threadId)
    return [
      board.tasks.find((one) => one.taskId === taskId)?.plan?.steps,
      coordinator.items.flatMap((one) => (one.kind === 'task' && one.content.taskId === taskId ? [one.content.plan?.steps] : []))[0],
      thread.task.steps,
    ] as const
  })

const stored = (planId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE id = ${planId}`
    return JSON.parse(row?.parameters ?? '{}') as { steps: ReadonlyArray<PlanStep>; leadChanged?: string }
  })

describe('the team a task leads from here', () => {
  it.live('shows a switched lead in every task view, and can choose the original lead again', () =>
    Effect.gen(function* () {
      const made = yield* started
      const sessions = yield* Sessions
      yield* sessions.switchAgent({ threadId: made.threadId, agentId: 'codex', model: 'large', effort: 'low' })
      const target = { ...lead, agentId: 'codex', model: 'large', effort: 'low' }
      const [board, coordinator, thread] = yield* until(projected(made.projectId, made.taskId, made.threadId), (views) =>
        views.every((steps) => steps?.[0]?.agentId === 'codex'),
      )
      assert.deepStrictEqual(board, [target, review])
      assert.deepStrictEqual(coordinator, [target, review])
      assert.deepStrictEqual(thread, [target, review])
      assert.deepStrictEqual((yield* stored(made.planId)).steps, [lead, review])

      const changed = yield* (yield* Runs).changeTeam({
        taskId: made.taskId,
        steps: [lead],
        actorId: (yield* Instance).personId,
      })
      assert.strictEqual(changed.lead?.step.agentId, 'claude-code')
      assert.strictEqual(changed.lead?.was.agentId, 'codex')
      assert.strictEqual(changed.review, undefined)
      assert.deepStrictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[0], [lead, review])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('shows pending model and effort choices, then the actual lead when its agent refuses one', () => {
    let hold = false
    return Effect.gen(function* () {
      const made = yield* started
      const sessions = yield* Sessions
      hold = true
      yield* sessions.chooseLead({ threadId: made.threadId, model: 'large' })
      yield* sessions.chooseLead({ threadId: made.threadId, effort: 'low' })
      assert.deepStrictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[0]?.[0], {
        ...lead,
        model: 'large',
        effort: 'low',
      })
      hold = false
      yield* until(
        (yield* Queries).thread(made.threadId),
        (read) => read.session?.model === 'large' && read.session.effort === 'low' && read.session.nextLead == null,
      )
      yield* sessions.chooseLead({ threadId: made.threadId, model: 'nowhere' })
      yield* until((yield* Queries).thread(made.threadId), (read) => read.session?.nextLead == null)
      assert.deepStrictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[2][0], {
        ...lead,
        model: 'large',
        effort: 'low',
      })
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holdsSets: () => hold })))))
  })

  it.live('preserves an explicit newer team choice past an unsuccessful replacement, and lets a later pick cancel it', () =>
    Effect.gen(function* () {
      const made = yield* started
      const sessions = yield* Sessions
      const wanted = { ...lead, agentId: 'codex', model: 'large', effort: 'low' }
      yield* (yield* Runs).changeTeam({ taskId: made.taskId, steps: [wanted], actorId: (yield* Instance).personId })
      // Picking the current lead again cancels the future team choice, even though this session began before that plan change.
      yield* sessions.chooseLead({ threadId: made.threadId, model: 'small', effort: 'high' })
      assert.deepStrictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[0]?.[0], lead)
      yield* sessions.stop(made.threadId)
      assert.isTrue(yield* sessions.startLast(made.threadId))
      assert.strictEqual((yield* (yield* Queries).thread(made.threadId)).session?.agentId, 'claude-code')
      yield* (yield* Runs).changeTeam({ taskId: made.taskId, steps: [wanted], actorId: (yield* Instance).personId })
      // The intended lead remains the next one even if a newer replacement row never became an active session.
      const sql = yield* SqlClient.SqlClient
      const [current] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${made.threadId} LIMIT 1`
      yield* sql`INSERT INTO provider_sessions (id, project_id, thread_id, agent_id, state, model, effort, started_at, config)
        SELECT 'sess_11111111111111111111111111111111', project_id, thread_id, 'opencode', 'failed', 'small', 'medium',
          ${isoAfter(1, yield* Clock.currentTimeMillis)}, config FROM provider_sessions WHERE id = ${current?.id ?? ''}`
      yield* sessions.stop(made.threadId)
      const planned = yield* stored(made.planId)
      assert.deepStrictEqual(yield* teamLeadOf(made.threadId, wanted, planned.leadChanged), wanted)
      assert.isTrue(yield* sessions.startLast(made.threadId))
      const restarted = (yield* (yield* Queries).thread(made.threadId)).session
      assert.deepStrictEqual([restarted?.agentId, restarted?.model, restarted?.effort], ['codex', 'large', 'low'])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('leaves an untouched reviewer in place and leaves proposed plans exactly as configured', () =>
    Effect.gen(function* () {
      const made = yield* started
      yield* (yield* Runs).changeTeam({
        taskId: made.taskId,
        steps: [{ ...lead, agentId: 'codex', model: 'large' }],
        actorId: (yield* Instance).personId,
      })
      assert.deepStrictEqual(
        (yield* stored(made.planId)).steps.find((one) => one.key === 'review'),
        review,
      )
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE task_plans SET state = 'proposed', parameters = ${JSON.stringify({ ...(yield* stored(made.planId)), steps: [lead, review] })}
        WHERE id = ${made.planId}`
      assert.deepStrictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[0], [lead, review])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('orders a persisted team change and a later session choice by the record on the same clock tick', () =>
    Effect.gen(function* () {
      const made = yield* started
      const clock = yield* Clock.Clock
      const at = yield* Clock.currentTimeMillis
      const nanos = BigInt(at) * 1_000_000n
      const fixed: Clock.Clock = {
        currentTimeMillis: Effect.succeed(at),
        currentTimeMillisUnsafe: () => at,
        currentTimeNanos: Effect.succeed(nanos),
        currentTimeNanosUnsafe: () => nanos,
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
      }
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const changedAt = yield* timestamp
        const wanted = { ...lead, agentId: 'codex', model: 'large', effort: 'low' }
        // The team write survived, before the session could take it up. Its time is the same as the next deliberate pick.
        const parameters = { ...(yield* stored(made.planId)), steps: [wanted, review], leadChanged: changedAt }
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('task_plans', made.planId, { parameters: JSON.stringify(parameters) })
            yield* fact({
              projectId: made.projectId as ProjectId,
              aggregateType: 'task_plan',
              aggregateId: made.planId,
              revision,
              type: 'task_plan.changed',
              payload: { leadChanged: changedAt },
              actorId: instance.personId,
            })
          }),
        )
        assert.deepStrictEqual(yield* teamLeadOf(made.threadId, wanted, changedAt), wanted)
        yield* (yield* Sessions).chooseLead({ threadId: made.threadId, model: 'small', effort: 'high' })
        const [chosen] = yield* sql<{ occurredAt: string }>`SELECT occurred_at FROM record_events
          WHERE type = 'provider_session.lead_choice_changed' ORDER BY sequence DESC LIMIT 1`
        assert.strictEqual(chosen?.occurredAt, changedAt)
        assert.deepStrictEqual(yield* teamLeadOf(made.threadId, wanted, changedAt), lead)
      }).pipe(Effect.provideService(Clock.Clock, fixed))
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('retains a pending model and effort through Stop and starting the lead again', () => {
    const slow = holds()
    return Effect.gen(function* () {
      const made = yield* started
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: made.threadId,
        body: '[answers-after:5s] Look at it.',
      })
      yield* until(sessions.running(made.threadId), (one) => Option.isSome(one) && one.value.turnRunning)
      yield* sessions.chooseLead({ threadId: made.threadId, model: 'large', effort: 'low' })
      yield* sessions.stop(made.threadId)
      assert.isTrue(yield* sessions.startLast(made.threadId))
      const read = yield* (yield* Queries).thread(made.threadId)
      assert.deepStrictEqual([read.session?.model, read.session?.effort], ['large', 'low'])
      assert.deepStrictEqual(read.task.steps[0], { ...lead, model: 'large', effort: 'low' })
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: slow })))))
  })

  it.live('keeps a newer unresolved effort when the earlier model pick is acknowledged, held and after Stop', () => {
    let silent = false
    let gateEffort = true
    const asked: Array<string> = []
    return Effect.gen(function* () {
      const made = yield* started
      const sessions = yield* Sessions
      asked.length = 0
      silent = true
      yield* sessions.chooseLead({ threadId: made.threadId, model: 'large' })
      yield* until(
        Effect.sync(() => asked),
        (all) => all.includes('model=large'),
      )
      yield* sessions.chooseLead({ threadId: made.threadId, effort: 'low' })
      silent = false
      yield* until(
        Effect.sync(() => asked),
        (all) => all.includes('effort=low'),
      )
      const held = Option.getOrThrow(yield* sessions.running(made.threadId))
      const sql = yield* SqlClient.SqlClient
      const [actual] = yield* sql<{
        model: string
        effort: string
      }>`SELECT model, effort FROM provider_sessions WHERE id = ${held.sessionId}`
      assert.deepStrictEqual([actual?.model, actual?.effort], ['large', 'high'])
      assert.strictEqual(held.nextLead?.effort, 'low')
      assert.strictEqual((yield* teamLeadOf(made.threadId, lead, undefined, held)).effort, 'low')
      assert.strictEqual((yield* projected(made.projectId, made.taskId, made.threadId))[0]?.[0]?.effort, 'low')
      yield* sessions.stop(made.threadId)
      assert.strictEqual((yield* teamLeadOf(made.threadId, lead)).effort, 'low')
      gateEffort = false
      silent = false
      assert.isTrue(yield* sessions.startLast(made.threadId))
      const restarted = (yield* (yield* Queries).thread(made.threadId)).session
      assert.deepStrictEqual([restarted?.model, restarted?.effort], ['large', 'low'])
    }).pipe(
      Effect.ensuring(Effect.sync(() => (silent = false))),
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', {
              holdsSets: () => silent,
              optionAsked: (id, value) => {
                asked.push(`${id}=${value}`)
                if (gateEffort && id === 'effort' && value === 'low') silent = true
              },
            }),
          ),
        ),
      ),
    )
  })
})
