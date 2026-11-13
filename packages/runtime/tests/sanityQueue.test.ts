import { makeFakeService, type FakeService } from '@althar/connectors/testing'
import { holds } from '@althar/provider-adapters/testing'
import { deadline } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agents } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Helpers } from '../src/Helpers'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeAgents, fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * Sanity pass over what made today's merge queue fail: each test here shows a defect found on current main, written to
 * assert the right behaviour and marked expected-to-fail. Each flips to passing once its defect is fixed.
 */

const runtimeWith = (github: FakeService, file: string, agents?: Layer.Layer<Agents>) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        file,
        {},
        { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1), ...(agents === undefined ? {} : { agents }) },
      ),
    ),
  )

/** The fake agents, but one, `gated`, whose start waits at Althar's lookup of it until the test opens the gate. */
const gatedAgents = (gate: Deferred.Deferred<void>) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const base = yield* Agents
      return Agents.of({
        list: base.list,
        get: (agentId) => (agentId === 'gated' ? Effect.andThen(Deferred.await(gate), base.get(agentId)) : base.get(agentId)),
      })
    }),
  ).pipe(Layer.provide(fakeAgents()))

/** Keeps the test's clock up with real time, as `onTestClock` does (support.ts), until the fiber running it is interrupted. */
const flowing = (clock: TestClock.TestClock) =>
  Effect.suspend(() => {
    let last = Date.now()
    return Effect.forever(
      Effect.andThen(
        clock.withLive(Effect.sleep(Duration.millis(10))),
        Effect.suspend(() => {
          const passed = Date.now() - last
          last += passed
          return clock.adjust(passed)
        }),
      ),
    )
  })

/** Reads until what it reads passes, sleeping on the live clock: the test's stays where it is meanwhile. */
const seen = <A, E, R>(read: Effect.Effect<A, E, R>, check: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (;;) {
      const value = yield* Effect.orDie(read)
      if (check(value)) return value
      if (Date.now() > deadline()) return yield* Effect.die(new Error(`Timed out waiting; last saw ${JSON.stringify(value)}`))
      yield* TestClock.withLive(Effect.sleep(Duration.millis(20)))
    }
  })

/** A task with its lead's work up as a pull request, its lead between turns: as helpersEdges.test.ts opens one. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const cards = Effect.map(Effect.orDie((yield* Queries).coordinator(project.projectId)), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
    )
    const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    return { projectId: project.projectId, taskId: card.taskId }
  })

const helperRow = (id: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ id: string; state: string; result: string | null }>`SELECT id, state, result FROM helpers WHERE id = ${id}`,
  )

describe('a helper started as Althar starts', () => {
  // Finding (sanity pass): two seconds after Althar starts, it carries on every helper at work whose agent isn't running,
  // as one left from before a restart (Helpers.ts `carryOn`, 512-536). A helper its lead starts in that moment, its
  // agent still starting, is taken for one: failed, "Althar restarted, and its agent couldn't start again", though
  // nothing restarted. This is why helpersEdges.test.ts:99 times out in CI (#817), and #803, #805, #806 and #814 with it:
  // their tests start a helper about two seconds into a runtime. Here the test's clock holds that moment, and the helper's
  // agent is held in its start, so it is the same every run. Flips to passing when fixed.
  it.effect('isn’t failed as one left from before a restart while its agent starts', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const file = join(mkdtempSync(join(tmpdir(), 'althar-sanity-helpers-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const clock = yield* TestClock.testClockWith(Effect.succeed)
      yield* clock.setTime(Date.now())
      // Althar's first run: a task whose lead can start helpers, with time going by as it does.
      const time = yield* Effect.forkChild(flowing(clock))
      const task = yield* Effect.gen(function* () {
        const task = yield* opened(working)
        const sql = yield* SqlClient.SqlClient
        // Truly left from before: its row exists before the second runtime begins, with no session to resume.
        yield* sql`INSERT INTO helpers ${sql.insert({
          id: 'hlp_orphan',
          taskId: task.taskId,
          projectId: task.projectId,
          threadId: 'thr_orphan',
          name: 'Orphan',
          brief: 'Read it.',
          agentId: 'claude-code',
          state: 'working',
          startedAt: new Date((yield* clock.currentTimeMillis) - 60_000).toISOString(),
        })}`
        return task
      }).pipe(Effect.provide(runtimeWith(github, file)))
      // Started again, the clock held: its look for helpers left at work, two seconds on, waits for the test.
      yield* Fiber.interrupt(time)
      const gate = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const helpers = yield* Helpers
        // The lead starts a helper, whose agent is still starting: held there.
        const starting = yield* Effect.forkChild(
          helpers.start({
            taskId: task.taskId,
            name: 'Fresh',
            brief: 'Look at the retry.',
            agentId: 'gated',
            model: null,
            modelName: 'Fake model',
          }),
        )
        const [fresh] = yield* seen(
          sql<{ id: string }>`SELECT id FROM helpers WHERE task_id = ${task.taskId} AND name = 'Fresh'`,
          (rows) => rows.length === 1,
        )
        const freshId = fresh?.id ?? assert.fail('no helper')
        // The old orphan's failure shows the recovery pass ran while the fresh helper was still starting.
        yield* clock.adjust(Duration.seconds(2))
        yield* seen(
          Effect.zip(helperRow(freshId), helperRow('hlp_orphan')),
          ([[one], [orphan]]) => one?.state !== 'working' || orphan?.state !== 'working',
        )
        const [after] = yield* helperRow(freshId)
        // Time goes on and the agent starts, so the runtime ends as it would.
        yield* Effect.forkChild(flowing(clock))
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(starting)
        assert.deepStrictEqual({ state: after?.state, result: after?.result }, { state: 'working', result: null })
      }).pipe(Effect.provide(runtimeWith(github, file, gatedAgents(gate))))
    })
  })
})

describe('helpers captured for restart recovery', () => {
  it.effect('does not revive one ended before the delayed recovery begins', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const file = join(mkdtempSync(join(tmpdir(), 'althar-ended-helper-')), 'runtime.sqlite')
    return Effect.gen(function* () {
      const clock = yield* TestClock.testClockWith(Effect.succeed)
      yield* clock.setTime(Date.now())
      const time = yield* Effect.forkChild(flowing(clock))
      yield* Effect.gen(function* () {
        const task = yield* opened(working)
        const sql = yield* SqlClient.SqlClient
        for (const name of ['Ended', 'Orphan'])
          yield* sql`INSERT INTO helpers ${sql.insert({
            id: `hlp_${name}`,
            taskId: task.taskId,
            projectId: task.projectId,
            threadId: `thr_${name}`,
            name,
            brief: 'Read it.',
            agentId: 'claude-code',
            state: 'working',
            startedAt: new Date(yield* clock.currentTimeMillis).toISOString(),
          })}`
      }).pipe(Effect.provide(runtimeWith(github, file)))
      yield* Fiber.interrupt(time)
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE helpers SET state = 'stopped', result = 'Stopped by the person.' WHERE id = 'hlp_Ended'`
        yield* clock.adjust(Duration.seconds(2))
        yield* seen(helperRow('hlp_Orphan'), ([row]) => row?.state === 'failed')
        assert.deepStrictEqual((yield* helperRow('hlp_Ended'))[0], { id: 'hlp_Ended', state: 'stopped', result: 'Stopped by the person.' })
        assert.deepStrictEqual(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = 'thr_Ended'`, [])
        assert.deepStrictEqual(yield* sql`SELECT id FROM user_inputs WHERE thread_id = 'thr_Ended'`, [])
        yield* Effect.forkChild(flowing(clock))
      }).pipe(Effect.provide(runtimeWith(github, file)))
    })
  })

  it.effect('keeps a helper stopped while its restart session is being prepared', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const file = join(mkdtempSync(join(tmpdir(), 'althar-stopped-helper-')), 'runtime.sqlite')
    const helperWork = holds()
    return Effect.gen(function* () {
      const clock = yield* TestClock.testClockWith(Effect.succeed)
      yield* clock.setTime(Date.now())
      const time = yield* Effect.forkChild(flowing(clock))
      const old = yield* Effect.gen(function* () {
        const task = yield* opened(working)
        yield* (yield* Helpers).start({
          taskId: task.taskId,
          name: 'Old',
          brief: 'Keep reading. [lead:slowly]',
          agentId: 'claude-code',
          model: null,
          modelName: 'Fake',
        })
        const sql = yield* SqlClient.SqlClient
        const [helper] = yield* sql<{
          id: string
          threadId: string
        }>`SELECT id, thread_id FROM helpers WHERE task_id = ${task.taskId} AND name = 'Old'`
        if (helper === undefined) return assert.fail('no helper')
        // Helpers honor slowly, not lead:wait. Hold its work until shutdown, and wait for the receipt rather than a short
        // busy window: this helper really was at work before the restart.
        yield* until(
          sql<{ id: string }>`SELECT d.id FROM turn_deliveries d JOIN record_events f ON f.aggregate_id = d.id
            AND f.aggregate_type = 'turn_delivery' AND f.type = 'turn_delivery.prompt_sent'
            WHERE d.thread_id = ${helper.threadId}`,
          (rows) => rows.length > 0,
        )
        assert.strictEqual((yield* helperRow(helper.id))[0]?.state, 'working')
        const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${helper.threadId}`
        return { helper, sessionId: session?.id ?? '' }
      }).pipe(Effect.provide(runtimeWith(github, file, fakeAgents({ holds: helperWork }))))
      yield* Fiber.interrupt(time)
      const gate = yield* Deferred.make<void>()
      const preparing = yield* Deferred.make<void>()
      const agents = Layer.effect(
        Agents,
        Effect.gen(function* () {
          const base = yield* Agents
          return Agents.of({
            ...base,
            get: (agentId) =>
              agentId === 'claude-code'
                ? Effect.andThen(Deferred.succeed(preparing, undefined), Effect.andThen(Deferred.await(gate), base.get(agentId)))
                : base.get(agentId),
          })
        }),
      ).pipe(Layer.provide(fakeAgents()))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* clock.adjust(Duration.seconds(2))
        yield* Deferred.await(preparing)
        yield* sql`UPDATE helpers SET state = 'stopped', result = 'Stopped during startup.' WHERE id = ${old.helper.id}`
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.forkChild(flowing(clock))
        yield* until(
          sql<{ state: string }>`SELECT state FROM provider_sessions WHERE thread_id = ${old.helper.threadId} AND id <> ${old.sessionId}`,
          (rows) => rows.length > 0 && rows.every((row) => row.state !== 'starting' && row.state !== 'active'),
        )
        assert.deepStrictEqual((yield* helperRow(old.helper.id))[0], {
          id: old.helper.id,
          state: 'stopped',
          result: 'Stopped during startup.',
        })
        assert.deepStrictEqual(
          yield* sql`SELECT id FROM user_inputs WHERE thread_id = ${old.helper.threadId} AND body LIKE 'Althar restarted%'`,
          [],
        )
      }).pipe(Effect.provide(runtimeWith(github, file, agents)))
    })
  })
})
