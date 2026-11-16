import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Deferred, Duration, Effect, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Sessions } from '../src/Sessions'
import { Busy } from '../src/Busy'
import { Runs } from '../src/Runs'
import { Policies } from '../src/Policies'
import * as Runtime from '../src/Runtime'
import { runtime, task, turns, until } from './support'

const over = (row: { readonly state: string }) => row.state !== 'pending' && row.state !== 'delivered'
const database = () => join(mkdtempSync(join(tmpdir(), 'althar-turn-recovery-')), 'profile.sqlite')
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      sender: { kind: 'window' },
    })
  })

/** A real live session and queued input that has not been claimed by a turn. */
const waiting = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { task: created, project } = yield* task('Survive a restart')
  yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: 'large', effort: 'high' })
  yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
  const waitingForPlace = yield* Deferred.make<void>()
  yield* sessions.gateTurns(() => Effect.as(Deferred.succeed(waitingForPlace, undefined), false))
  const input = yield* say(created.threadId, 'Check the refund path before carrying on.')
  yield* Deferred.await(waitingForPlace)
  return { threadId: created.threadId, projectId: project.projectId, taskId: created.taskId, inputId: input.inputId }
})

describe('queued input across runtime launches', () => {
  for (const sender of ['person', 'quiet', 'person before another crash'] as const) {
    it.live(`honors ${sender} input accepted while recovered ownership is still connecting`, () => {
      const service: { down: 'offline' | undefined } = { down: undefined }
      let finishStartup: () => void = () => {}
      const startup = new Promise<void>((resolve) => {
        finishStartup = resolve
      })
      return Effect.gen(function* () {
        const file = database()
        const snapshot = sender === 'person before another crash' ? database() : undefined
        const saved = yield* Effect.gen(function* () {
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
          yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
          service.down = 'offline'
          const prior = yield* say(created.threadId, 'The dispatched request retained for retry.')
          yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every(over))
          const fresh = yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', {}),
            threadId: created.threadId,
            body: 'Unsent quiet news that starts recovery.',
            quiet: true,
          })
          return { threadId: created.threadId, prior: prior.inputId, fresh: fresh.inputId }
        }).pipe(Effect.provide(runtime(file, { connection: () => service.down })))
        const currentId = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          yield* until(
            sql`SELECT id FROM provider_sessions WHERE thread_id = ${saved.threadId} AND state = 'starting'`,
            (rows) => rows.length === 1,
          )
          const current =
            sender !== 'quiet'
              ? yield* say(saved.threadId, 'Please retry my original request now.')
              : yield* sessions.send({
                  envelope: yield* Runtime.envelope('thread.send', {}),
                  threadId: saved.threadId,
                  body: 'More quiet news while connecting.',
                  quiet: true,
                })
          if (snapshot !== undefined) yield* sql`VACUUM INTO ${snapshot}`
          finishStartup()
          const recovered = yield* until(turns(saved.threadId), (rows) => rows.length === 3 && rows.every(over))
          const given = yield* sql<{ id: string }>`SELECT user_input_id AS id FROM turn_delivery_inputs
            WHERE delivery_id = ${recovered[2]?.id ?? ''} ORDER BY position`
          assert.deepStrictEqual(
            given.map((one) => one.id),
            sender !== 'quiet' ? [saved.prior, saved.fresh, current.inputId] : [saved.fresh, current.inputId],
          )
          const [retained] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.prior}`
          assert.strictEqual(retained?.state, sender !== 'quiet' ? 'delivered' : 'queued')
          return current.inputId
        }).pipe(
          Effect.ensuring(Effect.sync(finishStartup)),
          Effect.provide(runtime(file, {}, { each: { codex: { beforeNewSession: () => startup } } })),
        )
        if (snapshot !== undefined)
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const recovered = yield* until(turns(saved.threadId), (rows) => rows.length === 3 && rows.every(over))
            const given = yield* sql<{ id: string }>`SELECT user_input_id AS id FROM turn_delivery_inputs
            WHERE delivery_id = ${recovered[2]?.id ?? ''} ORDER BY position`
            assert.deepStrictEqual(
              given.map((one) => one.id),
              [saved.prior, saved.fresh, currentId],
              'the accepted resume request survives a crash before its session connects',
            )
          }).pipe(Effect.provide(runtime(snapshot)))
      })
    })
  }

  it.live('keeps a blocked compaction from letting recovered work bypass its machine place', () => {
    const service: { down: 'offline' | undefined } = { down: undefined }
    let finishStartup: () => void = () => {}
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve
    })
    return Effect.gen(function* () {
      const file = database()
      const saved = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
        service.down = 'offline'
        yield* sessions.compact({ envelope: yield* Runtime.envelope('thread.compact', {}), threadId: created.threadId })
        yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every(over))
        const input = yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: created.threadId,
          body: 'Fresh work still needs a machine place.',
          quiet: true,
        })
        return { threadId: created.threadId, inputId: input.inputId }
      }).pipe(Effect.provide(runtime(file, { connection: () => service.down })))
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        let placed = 0
        yield* sessions.gateTurns((_lead, work) =>
          Effect.gen(function* () {
            placed++
            yield* work(Effect.void)
            return true
          }),
        )
        finishStartup()
        const recovered = yield* until(turns(saved.threadId), (rows) => rows.length === 3 && rows.every(over))
        assert.strictEqual(placed, 1)
        assert.include(recovered[2]?.prompt ?? '', 'Fresh work still needs a machine place.')
        const given = yield* sql<{ id: string }>`SELECT user_input_id AS id FROM turn_delivery_inputs
          WHERE delivery_id = ${recovered[2]?.id ?? ''}`
        assert.deepStrictEqual(
          given.map((one) => one.id),
          [saved.inputId],
        )
      }).pipe(Effect.provide(runtime(file, {}, { each: { codex: { beforeNewSession: () => startup } } })))
    })
  })

  for (const ending of ['shutdown', 'crash'] as const) {
    it.live(`recovers only unsent input from a mixed queue after ${ending}, keeping dispatched input for deliberate retry`, () => {
      const service: { down: 'offline' | undefined } = { down: undefined }
      return Effect.gen(function* () {
        const file = database()
        const saved = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
          yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
          service.down = 'offline'
          const prior = yield* say(created.threadId, 'A previously dispatched request to refund the payment.')
          yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every(over))
          const fresh = yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', {}),
            threadId: created.threadId,
            body: 'Fresh quiet news that has never been dispatched.',
            quiet: true,
          })
          const [delivered] = yield* sql<{ deliveredAt: string | null }>`SELECT delivered_at FROM turn_deliveries
            WHERE thread_id = ${created.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
          assert.isNotNull(delivered?.deliveredAt)
          if (ending === 'crash') yield* sql`VACUUM INTO ${file}`
          return { threadId: created.threadId, prior: prior.inputId, fresh: fresh.inputId }
        }).pipe(Effect.provide(runtime(ending === 'shutdown' ? file : ':memory:', { connection: () => service.down })))
        service.down = undefined
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const busy = yield* Busy
          const linked = (deliveryId: string) =>
            Effect.map(
              sql<{ id: string }>`SELECT user_input_id AS id FROM turn_delivery_inputs
            WHERE delivery_id = ${deliveryId} ORDER BY position`,
              (rows) => rows.map((one) => one.id),
            )
          const paused = until(sessions.onTasks, (rows) =>
            rows.some((one) => one.threadId === saved.threadId && one.acceptingTurns === false),
          )
          const recovered = yield* until(turns(saved.threadId), (rows) => rows.length === 3 && rows.every(over))
          assert.deepStrictEqual(yield* linked(recovered[2]?.id ?? ''), [saved.fresh])
          assert.notInclude(recovered[2]?.prompt ?? '', 'A previously dispatched request to refund the payment.')
          yield* paused
          assert.lengthOf((yield* busy.now).holders, 0, 'retained dispatched input reserves no place')
          assert.isTrue(yield* sessions.retryable(saved.threadId), 'the person can still retry retained input')

          // An automatic replacement must keep the per-input boundary, even though it writes another brief.
          if (ending === 'shutdown') {
            yield* sessions.switchAgent({ threadId: saved.threadId, agentId: 'opencode' })
            yield* paused
          }
          const later = yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', {}),
            threadId: saved.threadId,
            body: 'More quiet news after recovery.',
            quiet: true,
          })
          const continued = yield* until(turns(saved.threadId), (rows) => rows.length === 4 && rows.every(over))
          assert.deepStrictEqual(yield* linked(continued[3]?.id ?? ''), [later.inputId])
          yield* paused
          const [retained] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.prior}`
          assert.strictEqual(retained?.state, 'queued')
          assert.lengthOf((yield* busy.now).holders, 0)

          const deliberate = ending === 'shutdown' ? undefined : yield* say(saved.threadId, 'Please retry my earlier request now.')
          if (ending === 'shutdown') assert.isTrue(yield* sessions.tryAgain(saved.threadId))
          const retried = yield* until(turns(saved.threadId), (rows) => rows.length === 5 && rows.every(over))
          assert.deepStrictEqual(
            yield* linked(retried[4]?.id ?? ''),
            deliberate === undefined ? [saved.prior] : [saved.prior, deliberate.inputId],
          )
          assert.lengthOf(
            yield* sql`SELECT d.id FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
            WHERE di.user_input_id = ${saved.prior} AND d.state = 'completed'`,
            1,
          )
        }).pipe(Effect.provide(runtime(file)))
      })
    })
  }

  it.live('resumes after clean shutdown on the same agent, model and effort, without another message', () =>
    Effect.gen(function* () {
      const file = database()
      const saved = yield* waiting.pipe(Effect.provide(runtime(file)))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const delivered = yield* until(turns(saved.threadId), (rows) => rows.length === 2 && rows.every(over))
        assert.strictEqual(delivered[1]?.state, 'completed')
        assert.include(delivered[1]?.prompt ?? '', 'Check the refund path before carrying on.')
        const sessions = yield* sql<{ agentId: string; model: string; effort: string }>`
        SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${saved.threadId} ORDER BY started_at, rowid`
        assert.deepStrictEqual(
          sessions.map((one) => [one.agentId, one.model, one.effort]),
          [
            ['codex', 'large', 'high'],
            ['codex', 'large', 'high'],
          ],
        )
        assert.lengthOf(yield* sql`SELECT delivery_id FROM turn_delivery_inputs WHERE user_input_id = ${saved.inputId}`, 1)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('resumes never-dispatched input from a crash snapshot', () =>
    Effect.gen(function* () {
      const snapshot = database()
      const saved = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const saved = yield* waiting
        // VACUUM exports a consistent database before this live launch's shutdown finalizers run.
        yield* sql`VACUUM INTO ${snapshot}`
        return saved
      }).pipe(Effect.provide(runtime()))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* until(turns(saved.threadId), (rows) => rows.length === 2 && rows.every(over))
        assert.strictEqual(rows[1]?.state, 'completed')
        assert.lengthOf(yield* sql`SELECT delivery_id FROM turn_delivery_inputs WHERE user_input_id = ${saved.inputId}`, 1)
      }).pipe(Effect.provide(runtime(snapshot)))
    }),
  )

  it.live('recovers the previous owner after a replacement failed and that owner later shut down', () =>
    Effect.gen(function* () {
      const file = database()
      const saved = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const saved = yield* waiting
        assert.isTrue((yield* Effect.exit(sessions.switchAgent({ threadId: saved.threadId, agentId: 'opencode' })))._tag === 'Failure')
        return saved
      }).pipe(
        Effect.provide(runtime(file, {}, { each: { opencode: { beforeNewSession: () => Promise.reject(new Error('Startup failed')) } } })),
      )
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        const rows = yield* until(turns(saved.threadId), (rows) => rows.length === 2 && rows.every(over))
        assert.strictEqual(rows[1]?.state, 'completed')
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(saved.threadId)).agentId, 'codex')
        assert.lengthOf(
          yield* sql`SELECT d.id FROM turn_delivery_inputs i JOIN turn_deliveries d ON d.id = i.delivery_id
        WHERE i.user_input_id = ${saved.inputId} AND d.state = 'completed'`,
          1,
        )
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('never replays a dispatched turn whose positive prompt receipt could not be recorded', () => {
    let takeSnapshot: (() => void) | undefined
    return Effect.gen(function* () {
      const file = database()
      const saved = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
        // Durable receipt recording can fail independently of the actual prompt send. Its absence proves nothing.
        yield* sql`CREATE TRIGGER fail_prompt_receipt BEFORE INSERT ON record_events
          WHEN NEW.type = 'turn_delivery.prompt_sent'
          BEGIN SELECT RAISE(FAIL, 'Receipt write unavailable'); END`
        const copied = yield* Deferred.make<void>()
        takeSnapshot = () => {
          takeSnapshot = undefined
          // The server has the request, before the adapter runs its started callback. Its effects may have happened.
          Effect.runFork(sql`VACUUM INTO ${file}`.pipe(Effect.andThen(Deferred.succeed(copied, undefined))))
        }
        const input = yield* say(created.threadId, 'Do the waiting work. [answers-after:5s]')
        yield* Deferred.await(copied)
        return { threadId: created.threadId, inputId: input.inputId }
      }).pipe(Effect.provide(runtime(':memory:', { promptAsked: () => takeSnapshot?.() })))
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        yield* Effect.yieldNow
        assert.strictEqual(yield* sessions.quiet(saved.threadId, Effect.succeed('still stopped')), 'still stopped')
        const rows = yield* turns(saved.threadId)
        assert.deepStrictEqual(
          rows.map((one) => one.state),
          ['completed', 'interruption_uncertain'],
        )
        assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${saved.threadId}`, 1)
        const [last] = yield* sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${saved.threadId}
          ORDER BY requested_at DESC, rowid DESC LIMIT 1`
        assert.lengthOf(
          yield* sql`SELECT sequence FROM record_events WHERE aggregate_id = ${last?.id ?? ''}
          AND type = 'turn_delivery.prompt_sent'`,
          0,
        )
        const [input] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.inputId}`
        assert.strictEqual(input?.state, 'delivered')
      }).pipe(Effect.provide(runtime(file)))
    })
  })

  for (const stop of ['completed', 'in preparation'] as const) {
    it.live(`keeps an explicit Stop durable after restart (${stop})`, () =>
      Effect.gen(function* () {
        const file = database()
        const saved = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const saved = yield* waiting
          if (stop === 'completed') {
            yield* sessions.stop(saved.threadId)
          } else {
            const prepared = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            yield* sessions.gateTurns((_lead, work) =>
              Effect.as(work(Effect.andThen(Deferred.succeed(prepared, undefined), Deferred.await(release))), true),
            )
            yield* sessions.wake(saved.threadId)
            yield* Deferred.await(prepared)
            const stopped = yield* Effect.forkChild(sessions.stop(saved.threadId))
            yield* until(
              sql`SELECT sequence FROM record_events WHERE type = 'provider_session.stop_requested'
            AND json_extract(payload, '$.reason') = 'stopped'`,
              (rows) => rows.length > 0,
            )
            // A crash during Stop preserves its intent while the pending turn still has queued input.
            yield* sql`VACUUM INTO ${file}`
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(stopped)
          }
          return saved
        }).pipe(Effect.provide(runtime(stop === 'completed' ? file : ':memory:', {}, { stopGrace: Duration.seconds(30) })))
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          // Quiet takes the same thread lock as recovery and observes any startup attempt to its end.
          yield* Effect.yieldNow
          assert.strictEqual(yield* sessions.quiet(saved.threadId, Effect.succeed('still stopped')), 'still stopped')
          assert.isTrue(Option.isNone(yield* sessions.running(saved.threadId)))
          const [input] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.inputId}`
          assert.strictEqual(input?.state, 'queued')
          assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${saved.threadId}`, 1)
        }).pipe(Effect.provide(runtime(file)))
      }),
    )
  }

  for (const excluded of ['abandoned', 'archived', 'suspended'] as const) {
    it.live(`leaves ${excluded} work stopped with its input queued`, () =>
      Effect.gen(function* () {
        const file = database()
        const saved = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const saved = yield* waiting
          if (excluded === 'abandoned') yield* sql`UPDATE tasks SET state = 'abandoned' WHERE id = ${saved.taskId}`
          if (excluded === 'archived')
            yield* sql`UPDATE projects SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ${saved.projectId}`
          if (excluded === 'suspended') {
            const workflowVersionId = yield* (yield* Runs).workflowVersion
            const policy = yield* (yield* Policies).current(saved.projectId as ProjectId)
            yield* sql`INSERT INTO runs (id, task_id, project_id, workflow_version_id, policy_id, state, created_at)
              VALUES ('run_0123456789abcdef0123456789abcdef', ${saved.taskId}, ${saved.projectId}, ${workflowVersionId},
                ${policy.id}, 'suspended', '2026-01-01T00:00:00.000Z')`
          }
          return saved
        }).pipe(Effect.provide(runtime(file)))
        yield* Effect.gen(function* () {
          const sessions = yield* Sessions
          yield* Effect.yieldNow
          assert.strictEqual(yield* sessions.quiet(saved.threadId, Effect.succeed('still stopped')), 'still stopped')
          const sql = yield* SqlClient.SqlClient
          assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${saved.threadId}`, 1)
        }).pipe(Effect.provide(runtime(file)))
      }),
    )
  }
})
