import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { change, fact, timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { stopWaiting, waitFor } from '../src/waits'
import { knownModels } from './knownModels'
import { callTool, notices, repository, runtime, until } from './support'

/*
 * Tasks wait for their blockers (docs/decisions/scheduling.md): a plan whose
 * time came doesn't start while a task it waits for is open, and starts by
 * itself once they have all merged. The person's Start now doesn't wait, and
 * Stop waiting takes one off. A task can't wait for itself, nor round a loop.
 * Its card names each with how it stands, and what waits for it.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const opened = Effect.gen(function* () {
  yield* knownModels
  const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId as ProjectId, threadId: yield* (yield* Coordinator).thread(project.projectId) }
})

/** A task drafted, its plan not proposed: a blocker, for these tests, whatever it does. */
const drafted = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description: 'Do it. [lead:finish]',
      draft: true,
    })
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${created.taskId}`
    return { taskId: created.taskId, threadId: created.threadId, slug: row?.slug ?? '' }
  })

/** Its plan proposed, to start at once unless something holds it. */
const planned = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Plans).propose({
      projectId,
      taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: (yield* Instance).coordinatorId,
      end: null,
      startsIn: Duration.zero,
    })
  })

/** The task ended as its pull request merging ends it, or as it is abandoned: its state, and the fact that says so. */
const ended = (taskId: string, state: 'done' | 'abandoned') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
    const revision = yield* change('tasks', taskId, { state, settledAt: yield* timestamp })
    yield* fact({
      projectId: task?.projectId ?? null,
      aggregateType: 'task',
      aggregateId: taskId,
      revision,
      type: state === 'done' ? 'task.done' : 'task.abandoned',
      payload: state === 'done' ? { merged: true } : {},
      actorId: (yield* Instance).systemId,
    })
  })

const planState = (planId: string) =>
  Effect.map(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM task_plans WHERE id = ${planId}`),
    (rows) => rows[0]?.state,
  )

describe('a task that waits for its blockers', () => {
  it.live('doesn’t start when its time comes while one is open, and starts by itself once the last one merges', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const instance = yield* Instance
      const pairing = yield* drafted(projectId, 'Pair a device')
      const hosts = yield* drafted(projectId, 'Hosts screen')
      const reconnect = yield* drafted(projectId, 'Reconnect on wake')
      yield* waitFor({ taskId: reconnect.taskId, on: [pairing.taskId, hosts.taskId], actorId: instance.coordinatorId })
      const planId = yield* planned(projectId, reconnect.taskId)
      yield* Effect.sleep('600 millis')
      assert.strictEqual(yield* planState(planId), 'proposed')
      // One merged, the other still open: it still waits.
      yield* ended(pairing.taskId, 'done')
      yield* Effect.sleep('600 millis')
      assert.strictEqual(yield* planState(planId), 'proposed')
      // Abandoned, it waits on the person rather than starting.
      yield* ended(hosts.taskId, 'abandoned')
      yield* Effect.sleep('600 millis')
      assert.strictEqual(yield* planState(planId), 'proposed')
      // Done after all: nothing it waits for is open, and it starts.
      yield* ended(hosts.taskId, 'done')
      yield* until(planState(planId), (state) => state === 'accepted')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('starts at once on the person’s word, and as planned once it stops waiting', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const instance = yield* Instance
      const plans = yield* Plans
      const sealing = yield* drafted(projectId, 'Seal secrets')
      const ssh = yield* drafted(projectId, 'SSH setup')
      const guide = yield* drafted(projectId, 'Write the guide')
      yield* waitFor({ taskId: ssh.taskId, on: [sealing.taskId], actorId: instance.coordinatorId })
      yield* waitFor({ taskId: guide.taskId, on: [sealing.taskId], actorId: instance.coordinatorId })
      const sshPlan = yield* planned(projectId, ssh.taskId)
      const guidePlan = yield* planned(projectId, guide.taskId)
      yield* Effect.sleep('400 millis')
      // Start now: the person's word doesn't wait.
      yield* plans.start(sshPlan, instance.personId)
      assert.strictEqual(yield* planState(sshPlan), 'accepted')
      // Stop waiting: it waits for nothing else, and starts as its time came.
      assert.isTrue(yield* stopWaiting({ taskId: guide.taskId, on: sealing.taskId, actorId: instance.personId }))
      yield* until(planState(guidePlan), (state) => state === 'accepted')
      assert.isFalse(yield* stopWaiting({ taskId: guide.taskId, on: sealing.taskId, actorId: instance.personId }))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('can’t wait for itself, nor round a loop; one merged already is nothing to wait for', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const instance = yield* Instance
      const a = yield* drafted(projectId, 'First')
      const b = yield* drafted(projectId, 'Second')
      const c = yield* drafted(projectId, 'Third')
      const merged = yield* drafted(projectId, 'Merged')
      yield* ended(merged.taskId, 'done')
      const by = instance.coordinatorId
      assert.deepStrictEqual(yield* waitFor({ taskId: b.taskId, on: [a.taskId], actorId: by }), [{ on: a.slug, added: true }])
      assert.deepStrictEqual(yield* waitFor({ taskId: c.taskId, on: [b.taskId], actorId: by }), [{ on: b.slug, added: true }])
      const [self, loop, done, again, unknown] = yield* waitFor({
        taskId: a.taskId,
        on: [a.taskId, c.taskId, merged.taskId, a.taskId, 'task_none'],
        actorId: by,
      })
      assert.deepStrictEqual(self, { on: a.slug, refused: 'A task can’t wait for itself.' })
      assert.deepStrictEqual(loop, { on: c.slug, refused: `${c.slug} waits for ${a.slug} already, so neither would ever start.` })
      assert.deepStrictEqual(done, { on: merged.slug, added: false, why: 'merged' })
      assert.deepStrictEqual(again, { on: a.slug, refused: 'A task can’t wait for itself.' })
      assert.deepStrictEqual(unknown, { on: 'task_none', refused: 'It isn’t a task of this project.' })
      // Named twice, it waits once.
      assert.deepStrictEqual(yield* waitFor({ taskId: b.taskId, on: [a.taskId], actorId: by }), [
        { on: a.slug, added: false, why: 'waits' },
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says on its card what it waits for and how each stands, and on theirs what waits for them', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const instance = yield* Instance
      const queries = yield* Queries
      const sealing = yield* drafted(projectId, 'Seal secrets')
      const service = yield* drafted(projectId, 'Host service')
      const hosts = yield* drafted(projectId, 'Hosts screen')
      const ssh = yield* drafted(projectId, 'SSH setup')
      yield* waitFor({ taskId: ssh.taskId, on: [sealing.taskId, service.taskId, hosts.taskId], actorId: instance.coordinatorId })
      yield* ended(service.taskId, 'done')
      yield* ended(hosts.taskId, 'abandoned')
      const card = yield* queries.card(ssh.taskId)
      assert.deepStrictEqual(
        card.waitsFor?.map((one) => [one.slug, one.stands]),
        [
          [sealing.slug, 'planned'],
          [service.slug, 'merged'],
          [hosts.slug, 'abandoned'],
        ],
      )
      assert.strictEqual(card.waitsFor?.[0]?.threadId, sealing.threadId)
      assert.isUndefined(card.waitedBy)
      const blocker = yield* queries.card(sealing.taskId)
      assert.deepStrictEqual(blocker.waitedBy, [{ taskId: ssh.taskId, slug: ssh.slug, title: 'SSH setup', threadId: ssh.threadId }])
      assert.isUndefined(blocker.waitsFor)
      // Started, it no longer says what it waited for, nor is it said to wait.
      const planId = yield* planned(projectId, ssh.taskId)
      yield* (yield* Plans).start(planId, instance.personId)
      yield* until(queries.card(ssh.taskId), (now) => now.waitsFor === undefined)
      assert.isUndefined((yield* queries.card(sealing.taskId)).waitedBy)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('the coordinator sets them with wait_for_tasks, and plans a task waiting with propose_plan’s waits_for', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const pairing = yield* drafted(projectId, 'Pair a device')
      const reconnect = yield* drafted(projectId, 'Reconnect on wake')
      assert.strictEqual(
        yield* callTool(access, 'wait_for_tasks', { task: reconnect.slug, on: [pairing.slug], why: 'the person asked' }),
        `${reconnect.slug} waits for ${pairing.slug}.`,
      )
      assert.include(
        (yield* notices(reconnect.threadId)).map((one) => one.title),
        'The coordinator made it wait for “Pair a device”: the person asked',
      )
      assert.match(
        yield* callTool(access, 'wait_for_tasks', { task: pairing.slug, on: [reconnect.slug] }),
        new RegExp(`^Not ${reconnect.slug}: ${reconnect.slug} waits for ${pairing.slug} already`),
      )
      assert.strictEqual(
        yield* callTool(access, 'wait_for_tasks', { task: reconnect.slug, stop: [pairing.slug] }),
        `${reconnect.slug} waits for no task now.`,
      )
      assert.match(yield* callTool(access, 'wait_for_tasks', { task: reconnect.slug }), /Name the tasks it waits for/)

      yield* callTool(access, 'draft_task', { title: 'Write the guide' })
      const said = yield* callTool(access, 'propose_plan', {
        task: 'write-the-guide',
        lead: { agent: 'codex', model: 'large' },
        small_change: true,
        waits_for: [pairing.slug],
      })
      assert.include(said, `It waits for ${pairing.slug}, and starts once it has merged.`)
      const sql = yield* SqlClient.SqlClient
      const plan = sql<{ id: string; state: string }>`
        SELECT p.id, p.state FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = 'write-the-guide'`
      // A small change starts at once, but not while what it waits for is open.
      yield* Effect.sleep('600 millis')
      assert.strictEqual((yield* plan)[0]?.state, 'proposed')
      yield* ended(pairing.taskId, 'done')
      yield* until(plan, (rows) => rows[0]?.state === 'accepted')
    }).pipe(Effect.provide(withQueries())),
  )
})
