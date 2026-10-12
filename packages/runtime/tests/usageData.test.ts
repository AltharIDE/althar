import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { fact, timestamp } from '../src/records'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { SignIns } from '../src/SignIns'
import { Tasks } from '../src/Tasks'
import { familyOf, tookBetween, UsageData, type UsageEvent } from '../src/UsageData'
import { repository, runtime, until } from './support'

/*
 * What anonymous usage data says happened, read from the record as it grows:
 * each event by its name, with counts, words from a short list and agents'
 * and model families' ids, never a name, a path or a title.
 */

const withUsage = (more: Parameters<typeof runtime>[2] = {}) => UsageData.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, more)))

/** Every usage event, as they come. */
const heard = Effect.gen(function* () {
  const usage = yield* UsageData
  const events: Array<UsageEvent> = []
  const fiber = yield* Effect.forkChild(Stream.runForEach(usage.events, (event) => Effect.sync(() => void events.push(event))))
  // Listening before anything is recorded.
  yield* Effect.sleep(Duration.millis(50))
  return { events, stop: Fiber.interrupt(fiber) }
})

const named = (events: ReadonlyArray<UsageEvent>, name: UsageEvent['name']) => events.filter((event) => event.name === name)

/** Waits until what was heard passes the check. */
const awaiting = (events: ReadonlyArray<UsageEvent>, check: (events: ReadonlyArray<UsageEvent>) => boolean) =>
  until(
    Effect.sync(() => [events]),
    (rows) => rows.some(check),
    Duration.seconds(20),
  )

const opened = (path = repository()) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

/** A draft task in a project, planned for its lead alone and accepted by `actor`: the person, or the coordinator, as its start_task does. */
const started = (projectId: string, title: string, by: (instance: Instance['Service']) => ActorId, model: string | null = null) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title, draft: true })
    const planId = yield* plans.propose({
      projectId: projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
    })
    yield* plans.start(planId, by(instance))
    return task
  })

describe('usage data', () => {
  it.live('says a project was made, with how many repositories, and the first one is the first screen’s', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      yield* opened()
      yield* awaiting(events, (seen) => named(seen, 'first_screen_done').length === 1)
      // An agent found signed in meanwhile is told apart.
      assert.deepStrictEqual(
        events.filter((event) => event.name !== 'agent_signed_in'),
        [
          { name: 'project_made', properties: { repositories: 1 } },
          { name: 'first_screen_done', properties: { repositories: 1 } },
        ],
      )
      yield* opened()
      yield* awaiting(events, (seen) => named(seen, 'project_made').length === 2)
      // Only the first project is the first screen's.
      assert.lengthOf(named(events, 'first_screen_done'), 1)
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  it.live('says a task started as planned or as a mini task, by its lead’s agent and model family, and how it settled', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const project = yield* opened()
      yield* started(project.projectId, 'Retry the checkout', (instance) => instance.personId, 'claude-opus-5')
      const mini = yield* started(project.projectId, 'Bump the lockfile', (instance) => instance.coordinatorId)
      yield* awaiting(events, (seen) => named(seen, 'task_started').length === 2)
      assert.deepStrictEqual(named(events, 'task_started'), [
        { name: 'task_started', properties: { as: 'planned', agent: 'claude-code', family: 'opus' } },
        { name: 'task_started', properties: { as: 'mini', agent: 'claude-code', family: 'default' } },
      ])
      // Its step is under way before it is abandoned.
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ id: string }>`SELECT n.id FROM nodes n JOIN workflow_executions x ON x.id = n.execution_id JOIN runs r ON r.id = x.run_id
          WHERE r.task_id = ${mini.taskId}`,
        (rows) => rows.length > 0,
      )
      const tasks = yield* Tasks
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: mini.taskId })
      yield* awaiting(events, (seen) => named(seen, 'task_settled').length === 1)
      const [settled] = named(events, 'task_settled')
      assert.deepStrictEqual(settled, { name: 'task_settled', properties: { as: 'abandoned', took: 'under_10m', steps: 1 } })
      // Nothing it said names the project, its folder or a task.
      assert.notMatch(JSON.stringify(events), /Retry|Bump|althar-repo|\//)
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  it.live('says a task started by writing to its lead, with no plan, once', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const project = yield* opened()
      const projects = yield* Projects
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Ask',
      })
      // Picking an agent starts a session on the task's own thread, and starts nothing yet.
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex', model: 'large' })
      yield* Effect.sleep(Duration.millis(800))
      assert.lengthOf(named(events, 'task_started'), 0)
      // What the person writes reaching it does; what they write after doesn't again.
      const say = (body: string) =>
        Effect.flatMap(Runtime.envelope('thread.send', { threadId: task.threadId, body }), (envelope) =>
          sessions.send({ envelope, threadId: task.threadId, body, disposition: 'after_current' }),
        )
      yield* say('Retry the checkout call')
      yield* awaiting(events, (seen) => named(seen, 'task_started').length === 1)
      yield* say('And log each retry')
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${task.threadId} AND state <> 'pending'`,
        (rows) => rows.length >= 2,
        Duration.seconds(20),
      )
      yield* Effect.sleep(Duration.millis(800))
      assert.deepStrictEqual(named(events, 'task_started'), [
        // The fake agent's models are no family Althar knows.
        { name: 'task_started', properties: { as: 'direct', agent: 'codex', family: 'other' } },
      ])
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  it.live('says a task settled when it merged here, and when its first pull request opened, but not again for another', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const project = yield* opened()
      const projects = yield* Projects
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = project.projectId as ProjectId
      const make = (title: string) =>
        Effect.flatMap(Runtime.envelope('task.create', {}), (envelope) => projects.createTask({ envelope, projectId, title }))
      const here = yield* make('Merged here')
      yield* fact({
        projectId,
        aggregateType: 'task',
        aggregateId: here.taskId,
        revision: 2,
        type: 'task.done',
        payload: { merged: true, here: [{ repository: 'meridian', branch: 'main', already: false }] },
        actorId: instance.personId,
      })
      // Merged on its host: it settled as its pull request already.
      const host = yield* make('Merged there')
      yield* fact({
        projectId,
        aggregateType: 'task',
        aggregateId: host.taskId,
        revision: 2,
        type: 'task.done',
        payload: { merged: true },
        actorId: instance.systemId,
      })
      const at = yield* timestamp
      for (const [id, number] of [
        [`xlink_${'1'.repeat(32)}`, 1],
        [`xlink_${'2'.repeat(32)}`, 2],
      ] as const) {
        yield* sql`INSERT INTO external_links (id, project_id, task_id, product, kind, external_id, ref, key, url, created_at, updated_at, revision)
          VALUES (${id}, ${projectId}, ${host.taskId}, 'github', 'change', ${String(number)}, ${`meridian#${number}`}, ${`#${number}`},
            ${`https://github.test/meridian/pull/${number}`}, ${at}, ${at}, 1)`
        yield* fact({
          projectId,
          aggregateType: 'external_link',
          aggregateId: id,
          revision: 1,
          type: 'external_link.change_opened',
          payload: { url: `https://github.test/meridian/pull/${number}`, number, draft: true },
          actorId: instance.systemId,
        })
      }
      // Abandoned after its pull request opened, it had settled already; reopened, it can settle again.
      const tasks = yield* Tasks
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: host.taskId })
      yield* awaiting(events, (seen) => named(seen, 'task_settled').length >= 2)
      yield* Effect.sleep(Duration.millis(800))
      assert.lengthOf(named(events, 'task_settled'), 2)
      yield* tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: host.taskId })
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: host.taskId })
      yield* awaiting(events, (seen) => named(seen, 'task_settled').length >= 3)
      yield* Effect.sleep(Duration.millis(800))
      assert.deepStrictEqual(
        named(events, 'task_settled').map((event) => event.properties),
        [
          { as: 'merged_here', took: 'under_10m', steps: 0 },
          { as: 'pull_request', took: 'under_10m', steps: 0 },
          { as: 'abandoned', took: 'under_10m', steps: 0 },
        ],
      )
      assert.notInclude(JSON.stringify(events), 'github.test')
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  it.live('says an ask was answered, by the person or by the coordinator, but not one the rules settled', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const project = yield* opened()
      // A step that never reports is stuck on the person, who answers it.
      yield* started(project.projectId, 'Quietly', (instance) => instance.personId)
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE state = 'open'`,
        (rows) => rows.length > 0,
        Duration.seconds(20),
      )
      const runs = yield* Runs
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      const instance = yield* Instance
      // One the rules settle was answered by no one.
      yield* fact({
        projectId: project.projectId as ProjectId,
        aggregateType: 'attention_request',
        aggregateId: call?.id ?? '',
        revision: 9,
        type: 'attention_request.answered',
        actorId: instance.systemId,
      })
      // The coordinator judged a permission in the person's place, and another it left to them.
      for (const applied of [true, false])
        yield* fact({
          projectId: project.projectId as ProjectId,
          aggregateType: 'permission_request',
          aggregateId: `perm_${String(applied)}`,
          revision: 2,
          type: 'permission_request.judged',
          payload: { decision: 'allow', applied },
          actorId: instance.coordinatorId,
        })
      yield* awaiting(events, (seen) => named(seen, 'ask_answered').length >= 2)
      yield* Effect.sleep(Duration.millis(800))
      assert.deepStrictEqual(
        named(events, 'ask_answered').map((event) => event.properties),
        [
          { ask: 'stuck', by: 'person' },
          { ask: 'permission', by: 'coordinator' },
        ],
      )
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  it.live('says an agent reached its usage limit once each time it is out, until its reset or an hour where none is known', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const instance = yield* Instance
      const limited = (accountId: string, agentId: string, resetsAt?: string) =>
        fact({
          aggregateType: 'account_status',
          aggregateId: `ast_${accountId}_${Math.random().toString(36).slice(2)}`,
          revision: 1,
          type: 'account_status.limited',
          payload: { agentId, accountId, ...(resetsAt === undefined ? {} : { resetsAt }) },
          actorId: instance.systemId,
        })
      const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString()
      // Out for five hours: hit again meanwhile, it is the same time out.
      yield* limited('acct_work', 'codex', hours(5))
      yield* limited('acct_work', 'codex', hours(5))
      // Its reset has passed: hit again, it is out again.
      yield* limited('acct_home', 'claude-code', hours(-0.1))
      yield* limited('acct_home', 'claude-code', hours(4))
      // No reset known: an hour.
      yield* limited('acct_open', 'opencode')
      yield* limited('acct_open', 'opencode')
      yield* awaiting(events, (seen) => named(seen, 'usage_limit_hit').length >= 4)
      yield* Effect.sleep(Duration.millis(800))
      assert.deepStrictEqual(
        named(events, 'usage_limit_hit').map((event) => event.properties),
        [{ agent: 'codex' }, { agent: 'claude-code' }, { agent: 'claude-code' }, { agent: 'opencode' }],
      )
      yield* stop
    }).pipe(Effect.provide(withUsage())),
  )

  const away: Array<string> = []
  it.live('says an agent was found signed in, once a launch, and signed in when an account that was out signs in', () =>
    Effect.gen(function* () {
      const { events, stop } = yield* heard
      const accounts = yield* Accounts
      const signIns = yield* SignIns
      const [usual] = yield* accounts.of('codex')
      assert.isDefined(usual)
      if (usual === undefined) return
      yield* signIns.account(usual, true)
      yield* signIns.account(usual, true)
      yield* awaiting(events, (seen) => seen.length >= 1)
      // Signed out, then in again.
      away.push('codex')
      yield* signIns.account(usual, true)
      away.splice(0)
      yield* signIns.account(usual, true)
      yield* awaiting(events, (seen) => seen.length >= 2)
      // Signed out again, then two checks at once see it signed in: said once.
      away.push('codex')
      yield* signIns.account(usual, true)
      away.splice(0)
      yield* Effect.all([signIns.account(usual, true), signIns.account(usual, true)], { concurrency: 'unbounded' })
      yield* awaiting(events, (seen) => seen.length >= 3)
      yield* Effect.sleep(Duration.millis(300))
      assert.deepStrictEqual(named(events, 'agent_signed_in'), [
        { name: 'agent_signed_in', properties: { agent: 'codex', how: 'found' } },
        { name: 'agent_signed_in', properties: { agent: 'codex', how: 'signed_in' } },
        { name: 'agent_signed_in', properties: { agent: 'codex', how: 'signed_in' } },
      ])
      yield* stop
    }).pipe(Effect.provide(withUsage({ signedOut: away }))),
  )
})

describe('what usage data says', () => {
  it('names a model by its family, never by its own name', () => {
    assert.strictEqual(familyOf(null), 'default')
    assert.strictEqual(familyOf('default'), 'default')
    assert.strictEqual(familyOf('claude-opus-5'), 'opus')
    assert.strictEqual(familyOf('sonnet[1m]'), 'sonnet')
    assert.strictEqual(familyOf('gpt-5.2-codex'), 'gpt')
    assert.strictEqual(familyOf('opencode-go/glm-5.3'), 'glm')
    assert.strictEqual(familyOf('qwen3-coder'), 'qwen')
    assert.strictEqual(familyOf('acme-internal/secret-model-7'), 'other')
  })

  it('says how long a task took as a bucket', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 12) + minutes * 60_000).toISOString()
    assert.strictEqual(tookBetween(at(0), at(9)), 'under_10m')
    assert.strictEqual(tookBetween(at(0), at(10)), '10m_to_1h')
    assert.strictEqual(tookBetween(at(0), at(60)), '1h_to_1d')
    assert.strictEqual(tookBetween(at(0), at(60 * 24)), 'over_1d')
  })
})
