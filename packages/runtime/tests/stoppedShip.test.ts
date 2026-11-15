import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Deferred, Duration, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { ShipRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/* An explicit Ship accepts finite committed work from a stopped workflow without resuming its old implementation. */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

const commit = (path: string, file: string) => {
  appendFileSync(join(path, file), `${file}\n`)
  git(path, 'add', file)
  git(path, 'commit', '-q', '-m', file)
  return git(path, 'rev-parse', 'HEAD')
}

const layer = (github: FakeService, reviewing: () => boolean) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        { holds: { open: () => {}, opened: (marker) => marker === '[review:slowly]' && reviewing() } },
        { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) },
      ),
    ),
  )

const runStates = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) =>
      sql<{ id: string; state: string; parameters: string; planId: string | null }>`
      SELECT id, state, parameters, plan_id FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`,
  )

for (const stopping of ['interrupt', 'stop task'] as const) {
  for (const reviewed of [false, true]) {
    describe(`a Ship after ${stopping}`, () => {
      it.live(
        `retires only the stopped workflow and ships its accepted commits ${reviewed ? 'after its configured review' : 'without a reviewer'}`,
        () => {
          const { working, bare } = hosted()
          const github = makeFakeService({ pushUrl: () => bare })
          github.addRepository(['meridian', 'api'])
          let reviewDone = false
          return Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const instance = yield* Instance
            const sessions = yield* Sessions
            const runs = yield* Runs
            yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
            const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
            const task = yield* (yield* Projects).createTask({
              envelope: yield* Runtime.envelope('task.create', {}),
              projectId: project.projectId,
              title: 'The stopped change',
              description: 'Do the work. [lead:wait] [review:slowly]',
              draft: true,
            })
            const plans = yield* Plans
            const planId = yield* plans.propose({
              projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
              taskId: task.taskId,
              steps: [
                { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
                ...(reviewed ? [{ key: 'review' as const, agentId: 'codex', model: null, skipped: false }] : []),
              ],
              end: 'draft',
              held: true,
              reason: null,
              actorId: instance.personId,
            })
            yield* plans.start(planId, instance.personId)
            yield* until(sessions.running(task.threadId), (on) => Option.isSome(on) && on.value.turnRunning)
            const [workspace] = yield* sql<{ id: string; path: string }>`SELECT id, path FROM workspaces WHERE task_id = ${task.taskId}`
            const path = workspace?.path ?? assert.fail('no worktree')
            const accepted = commit(path, 'accepted.txt')
            const request = { envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId }
            const refused = yield* Effect.flip(runs.ship(request))
            assert.instanceOf(refused, ShipRefused)
            assert.strictEqual((refused as ShipRefused).why, 'working')
            assert.lengthOf(yield* runStates(task.taskId), 1)

            if (stopping === 'interrupt') {
              // A deferred request made before Stop must not acquire the explicit press's permission to retire it.
              yield* runs.ship({ ...request, afterTurn: true })
              yield* sessions.interrupt(task.threadId)
            } else yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
            yield* until(
              Effect.flatMap(Queries, (queries) => queries.thread(task.threadId)),
              (view) => view.task.phase === 'stopped',
            )
            yield* until(sessions.busy(task.threadId), (busy) => !busy)
            const [old] = yield* runStates(task.taskId)
            assert.strictEqual(old?.state, stopping === 'interrupt' ? 'running' : 'suspended')
            if (stopping === 'interrupt')
              yield* until(
                sql`SELECT id FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'notice'
                AND json_extract(content, '$.title') LIKE 'Shipping could not start.%'`,
                (rows) => rows.length > 0,
              )
            assert.lengthOf(github.changes, 0)
            assert.lengthOf(yield* runStates(task.taskId), 1)

            yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
            if (reviewed) {
              yield* until(
                sql<{ state: string }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
                WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
                (rows) => rows[0]?.state === 'running',
              )
              assert.lengthOf(github.changes, 0)
              // An adjacent later commit is outside the accepted review and must remain local and held.
              commit(path, 'later.txt')
              reviewDone = true
            }
            yield* until(
              Effect.sync(() => github.changes),
              (all) => all.length === 1,
            )
            yield* until(runStates(task.taskId), (all) => all.at(-1)?.state === 'succeeded')
            const states = yield* runStates(task.taskId)
            assert.deepStrictEqual(
              states.map((one) => one.state),
              ['cancelled', 'succeeded'],
            )
            assert.strictEqual(states[0]?.planId, planId)
            assert.isNull(states[1]?.planId)
            assert.strictEqual(JSON.parse(states[1]?.parameters ?? '{}').ships.heads[workspace?.id ?? ''], accepted)
            assert.strictEqual(git(bare, 'show', 'althar/the-stopped-change:accepted.txt'), 'accepted.txt')
            if (reviewed) {
              const absent = execFileSync('git', ['ls-tree', '--name-only', 'althar/the-stopped-change'], { cwd: bare }).toString()
              assert.notInclude(absent, 'later.txt')
              const [hold] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${task.taskId}`
              assert.isNotNull(hold?.heldAt)
              const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE id = ${planId}`
              assert.isFalse(JSON.parse(plan?.parameters ?? '{}').steps.find((step: { key: string }) => step.key === 'review').skipped)
            }
            // Ship did not restart the old implementation, and no active predecessor can resume on restart.
            assert.strictEqual(
              (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${task.threadId}`)[0]?.n,
              1,
            )
            assert.deepStrictEqual(yield* sql`SELECT id FROM run_attempts WHERE run_id = ${old?.id ?? ''} AND state = 'active'`, [])
            assert.deepStrictEqual(
              yield* sql`SELECT id FROM record_events WHERE aggregate_type = 'run' AND aggregate_id = ${old?.id ?? ''} AND type = 'run.resumed'`,
              [],
            )
          }).pipe(Effect.provide(layer(github, () => reviewDone)))
        },
      )
    })
  }
}

describe('a stopped publication that may still be at the host', () => {
  it.live('keeps the original workflow for reconciliation even after Stop cancelled its publish attempt', () => {
    const { working, bare } = hosted()
    const gate = Deferred.makeUnsafe<void>()
    const github = makeFakeService({
      pushUrl: () => bare,
      waitsFor: (method) => (method === 'openChange' ? Deferred.await(gate) : Effect.void),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const runs = yield* Runs
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Publishing change',
        description: 'Do the work. [lead:finish] [lead:edit]',
        draft: true,
      })
      const plans = yield* Plans
      const planId = yield* plans.propose({
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        end: 'draft',
        held: true,
        reason: null,
        actorId: instance.personId,
      })
      yield* plans.start(planId, instance.personId)
      yield* until(
        Effect.sync(() => github.calls),
        (calls) => calls.includes('openChange'),
      )
      yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      yield* until((yield* Sessions).busy(task.threadId), (busy) => !busy)
      const before = yield* runStates(task.taskId)
      assert.strictEqual(before[0]?.state, 'suspended')
      const [publish] = yield* sql<{ state: string }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
        JOIN workflow_executions e ON e.id = n.execution_id WHERE e.run_id = ${before[0]?.id ?? ''} AND n.node_key = 'publish'`
      assert.strictEqual(publish?.state, 'cancelled')
      const press = { envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId }
      const refused = yield* Effect.exit(runs.ship(press))
      assert.strictEqual(refused._tag, 'Failure')
      if (refused._tag === 'Failure') {
        const error = Option.getOrThrow(Cause.findErrorOption(refused.cause))
        assert.instanceOf(error, ShipRefused)
        assert.strictEqual((error as ShipRefused).why, 'working')
      }
      assert.deepStrictEqual(yield* runStates(task.taskId), before)
      assert.lengthOf(github.changes, 0)
      yield* Deferred.succeed(gate, undefined)
      // A late host acknowledgement belongs to the original workflow and cannot complete a replacement Ship.
      yield* until(
        sql`SELECT id FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'
          AND json_extract(content, '$.step') = 'publish'`,
        (rows) => rows.length > 0,
      )
      assert.deepStrictEqual(yield* runStates(task.taskId), before)
      const stillRefused = yield* Effect.flip(runs.ship(press))
      assert.instanceOf(stillRefused, ShipRefused)
      // Explicitly resuming the original reconciles the accepted host result, without creating a second pull request.
      yield* runs.resume({ envelope: yield* Runtime.envelope('task.resume', {}), taskId: task.taskId })
      const resumed = yield* until(runStates(task.taskId), (all) => all[0]?.state === 'succeeded')
      assert.lengthOf(resumed, 1)
      assert.strictEqual(resumed[0]?.id, before[0]?.id)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.ensuring(Effect.asVoid(Deferred.succeed(gate, undefined))), Effect.provide(layer(github, () => true)))
  })
})
