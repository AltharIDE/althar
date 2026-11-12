import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Deferred, Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Busy } from '../src/Busy'
import { Connections } from '../src/Connections'
import { externalWaitOf } from '../src/externalWaits'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, hosted, HOST, notices, onTestClock, repository, runtime, turns, until, withWork } from './support'

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))
const held = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; output: string; state: string }>`
    SELECT a.id, a.output, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
    JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
    WHERE r.task_id = ${taskId} AND a.state = 'held' AND a.hold_reason = 'external'`
  })

/** Hold the first lead turn so the test can declare its wait through the real MCP boundary. */
const planned = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Watch the backlog',
      description: withWork('Wait for the backlog. [lead:slowly] [lead:finish]', false),
      draft: true,
      plain: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      held: true,
      end: 'none',
      here: true,
    })
    yield* plans.start(planId, instance.personId)
    const sql = yield* SqlClient.SqlClient
    const [attempt] = yield* until(
      sql<{ id: string; sessionId: string }>`
    SELECT a.id, a.provider_session_id AS session_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
    JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
    WHERE r.task_id = ${task.taskId} AND a.state = 'running' AND a.provider_session_id IS NOT NULL`,
      (rows) => rows.length === 1,
    )
    const access: ToolAccess = {
      role: 'lead',
      taskId: task.taskId,
      threadId: task.threadId,
      projectId: project.projectId,
      sessionId: attempt?.sessionId ?? '',
    }
    return { ...task, projectId: project.projectId as ProjectId, access }
  })

const idle = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(sessions.running(threadId), (one) => Option.isSome(one) && !one.value.turnRunning)
  })

const ready = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const card = yield* until(
      Effect.map(queries.board(projectId), (board) => board.tasks.find((one) => one.taskId === taskId)),
      (card) => card?.phase === 'ready' || card?.phase === 'waiting',
    )
    const sql = yield* SqlClient.SqlClient
    assert.strictEqual(
      card?.phase,
      'ready',
      JSON.stringify(yield* sql`SELECT kind, payload FROM attention_requests WHERE task_id = ${taskId} AND state = 'open'`),
    )
    return card
  })

describe('a lead waiting for an external condition', () => {
  it.effect('yields its agent place, stays Running without reminders, and resumes once at the requested time', () => {
    const gate = holds()
    return onTestClock(
      Effect.gen(function* () {
        const task = yield* planned(repository())
        const now = yield* Clock.currentTimeMillis
        assert.include(
          yield* callTool(task.access, 'wait_for', {
            reason: 'Check the deployment',
            conditions: [{ kind: 'time', at: new Date(now + 30_000).toISOString() }],
          }),
          'Althar is watching',
        )
        assert.include(yield* callTool(task.access, 'finish_step', { summary: 'Still waiting.' }), 'waiting on an external condition')
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        const [waiting] = yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.lastCheck != null)
        assert.isDefined(waiting)
        const board = yield* (yield* Queries).board(task.projectId)
        const card = board.tasks.find((one) => one.taskId === task.taskId)
        assert.strictEqual(card?.phase, 'running')
        assert.strictEqual(card?.externalWait?.reason, 'Check the deployment')
        assert.isFalse((yield* (yield* Busy).now).holders.some((one) => one.taskId === task.taskId))
        assert.lengthOf(yield* turns(task.threadId), 1)
        yield* TestClock.adjust(Duration.seconds(10))
        assert.lengthOf(yield* turns(task.threadId), 1)
        assert.isFalse((yield* notices(task.threadId)).some((one) => /report|remind/i.test(one.title ?? '')))
        yield* TestClock.adjust(Duration.seconds(30))
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* turns(task.threadId), 2)
        assert.lengthOf(yield* held(task.taskId), 0)
      }).pipe(Effect.provide(withQueries(':memory:', { holds: gate }))),
    )
  })

  it.effect('watches several other PRs, and all mode resumes only after every scoped PR is confirmed merged', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        for (const source of ['first', 'second', 'outside'])
          github.addPullRequest({ path: ['meridian', 'api'], title: source, author: 'ada', source })
        const task = yield* planned(working)
        assert.include(
          yield* callTool(task.access, 'wait_for', {
            reason: 'Merge PRs #1 and #2',
            mode: 'all',
            conditions: [1, 2].map((number) => ({ kind: 'pull_request', repository: 'meridian/api', number, until: 'merged' })),
          }),
          'Althar is watching',
        )
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.lastCheck != null)
        github.mergeByHand(1)
        yield* TestClock.adjust(Duration.seconds(31))
        const [oneLeft] = yield* until(
          held(task.taskId),
          (rows) => externalWaitOf(rows[0]?.output ?? null)?.conditions[0]?.seen === 'merged',
        )
        assert.isDefined(oneLeft)
        assert.lengthOf(yield* turns(task.threadId), 1)
        github.mergeByHand(2)
        yield* TestClock.adjust(Duration.seconds(31))
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* turns(task.threadId), 2)
        assert.lengthOf(github.merged, 0)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('does not wake after Stop, even when its wake-up time passes', () => {
    const gate = holds()
    return onTestClock(
      Effect.gen(function* () {
        const task = yield* planned(repository())
        const now = yield* Clock.currentTimeMillis
        yield* callTool(task.access, 'wait_for', {
          reason: 'Wait briefly',
          conditions: [{ kind: 'time', at: new Date(now + 10_000).toISOString() }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
        yield* TestClock.adjust(Duration.seconds(20))
        assert.lengthOf(yield* held(task.taskId), 0)
        assert.lengthOf(yield* turns(task.threadId), 1)
        const card = (yield* (yield* Queries).board(task.projectId)).tasks.find((one) => one.taskId === task.taskId)
        assert.strictEqual(card?.phase, 'stopped')
      }).pipe(Effect.provide(withQueries(':memory:', { holds: gate }))),
    )
  })

  it.effect('a person’s new instruction cancels the wait before the lead uses its step tools', () => {
    const gate = holds()
    return onTestClock(
      Effect.gen(function* () {
        const task = yield* planned(repository())
        const now = yield* Clock.currentTimeMillis
        yield* callTool(task.access, 'wait_for', {
          reason: 'Wait briefly',
          conditions: [{ kind: 'time', at: new Date(now + 60_000).toISOString() }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: task.threadId,
          body: 'Carry on with the task now; there is no need to wait.',
        })
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* held(task.taskId), 0)
        assert.lengthOf(yield* turns(task.threadId), 2)
      }).pipe(Effect.provide(withQueries(':memory:', { holds: gate }))),
    )
  })

  it.effect('stopping the lead directly cancels its wait instead of waking it later', () => {
    const gate = holds()
    return onTestClock(
      Effect.gen(function* () {
        const task = yield* planned(repository())
        const now = yield* Clock.currentTimeMillis
        yield* callTool(task.access, 'wait_for', {
          reason: 'Wait briefly',
          conditions: [{ kind: 'time', at: new Date(now + 30_000).toISOString() }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* (yield* Sessions).stop(task.threadId)
        yield* until(held(task.taskId), (rows) => rows.length === 0)
        yield* TestClock.adjust(Duration.seconds(31))
        assert.lengthOf(yield* turns(task.threadId), 1)
      }).pipe(Effect.provide(withQueries(':memory:', { holds: gate }))),
    )
  })

  it.effect('a host response arriving after Stop cannot restart the task', () => {
    const gate = holds()
    const { working, bare } = hosted()
    let waitForRead = Effect.void
    const github = makeFakeService({ pushUrl: () => bare, waitsFor: (method) => (method === 'change' ? waitForRead : Effect.void) })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada' })
    return onTestClock(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        waitForRead = Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release))
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        yield* callTool(task.access, 'wait_for', {
          reason: 'Merge PR #1',
          conditions: [{ kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'merged' }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* Deferred.await(entered)
        yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
        github.mergeByHand(1)
        yield* Deferred.succeed(release, undefined)
        const sql = yield* SqlClient.SqlClient
        yield* until(
          sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${task.taskId}`,
          (rows) => rows[0]?.state === 'suspended',
        )
        assert.lengthOf(yield* turns(task.threadId), 1)
        assert.lengthOf(yield* held(task.taskId), 0)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('retains a review change in all mode while a second condition is still pending', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada' })
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        const now = yield* Clock.currentTimeMillis
        yield* callTool(task.access, 'wait_for', {
          reason: 'A review and its time',
          mode: 'all',
          conditions: [
            { kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'changed' },
            { kind: 'time', at: new Date(now + 60_000).toISOString() },
          ],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.lastCheck != null)
        github.reviewAs(1, 'dana', 'approved', 'Looks right.')
        yield* TestClock.adjust(Duration.seconds(31))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.conditions[0]?.met === true)
        assert.lengthOf(yield* turns(task.threadId), 1)
        yield* TestClock.adjust(Duration.seconds(31))
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* turns(task.threadId), 2)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('treats absent checks and rate limits as unknown, respects retry time, then wakes on completed checks', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada' })
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        yield* callTool(task.access, 'wait_for', {
          reason: 'Checks on PR #1',
          timeout_seconds: 300,
          conditions: [{ kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'checks_complete' }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.lastCheck != null)
        assert.lengthOf(yield* turns(task.threadId), 1)
        const retryAt = new Date((yield* Clock.currentTimeMillis) + 90_000).toISOString()
        github.failNext('checks', 'rate_limited', retryAt)
        yield* TestClock.adjust(Duration.seconds(31))
        const [failed] = yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.error != null)
        assert.isAtLeast(Date.parse(externalWaitOf(failed?.output ?? null)?.nextCheck ?? ''), Date.parse(retryAt))
        const reads = github.calls.filter((one) => one === 'checks').length
        yield* TestClock.adjust(Duration.seconds(30))
        assert.strictEqual(github.calls.filter((one) => one === 'checks').length, reads)
        assert.lengthOf(yield* turns(task.threadId), 1)
        github.setChecks(1, [{ name: 'test', state: 'failed' }])
        yield* TestClock.adjust(Duration.seconds(61))
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* turns(task.threadId), 2)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('a closed unmerged PR asks the person instead of reporting the backlog complete', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada', state: 'closed' })
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        yield* callTool(task.access, 'wait_for', {
          reason: 'Merge the backlog',
          conditions: [{ kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'merged' }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        const sql = yield* SqlClient.SqlClient
        const [call] = yield* until(
          sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${task.taskId} AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.include(call?.payload ?? '', 'closed without merging')
        assert.lengthOf(yield* turns(task.threadId), 1)
        assert.lengthOf(yield* held(task.taskId), 0)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('watches checks on the default branch without needing a task-owned PR', () => {
    const gate = holds()
    const { working, bare } = hosted()
    let passing = false
    const github = makeFakeService({
      pushUrl: () => bare,
      checksOn: (ref) => (ref === 'main' ? [{ name: 'build', state: passing ? 'passed' : 'running' }] : []),
    })
    github.addRepository(['meridian', 'api'])
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        yield* callTool(task.access, 'wait_for', {
          reason: 'Main to go green',
          conditions: [{ kind: 'checks', repository: 'meridian/api', ref: 'main', until: 'checks_passed' }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.lastCheck != null)
        assert.lengthOf(yield* turns(task.threadId), 1)
        passing = true
        yield* TestClock.adjust(Duration.seconds(31))
        yield* ready(task.projectId, task.taskId)
        assert.lengthOf(yield* turns(task.threadId), 2)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('an alternative timer wakes on time without reading a rate-limited host early', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada' })
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        const now = yield* Clock.currentTimeMillis
        github.failNext('change', 'rate_limited', new Date(now + 90_000).toISOString())
        yield* callTool(task.access, 'wait_for', {
          reason: 'The PR or a reminder',
          mode: 'any',
          conditions: [
            { kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'merged' },
            { kind: 'time', at: new Date(now + 10_000).toISOString() },
          ],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(2))
        yield* until(held(task.taskId), (rows) => externalWaitOf(rows[0]?.output ?? null)?.error != null)
        const reads = github.calls.filter((one) => one === 'change').length
        yield* TestClock.adjust(Duration.seconds(10))
        yield* ready(task.projectId, task.taskId)
        assert.strictEqual(github.calls.filter((one) => one === 'change').length, reads)
        assert.lengthOf(yield* turns(task.threadId), 2)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('an unmet wait reaches its deadline without starting another model turn', () => {
    const gate = holds()
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A change', author: 'ada' })
    return onTestClock(
      Effect.gen(function* () {
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
        const task = yield* planned(working)
        yield* callTool(task.access, 'wait_for', {
          reason: 'Merge the backlog',
          timeout_seconds: 5,
          conditions: [{ kind: 'pull_request', repository: 'meridian/api', number: 1, until: 'merged' }],
        })
        gate.open('[lead:slowly]')
        yield* idle(task.threadId)
        yield* TestClock.adjust(Duration.seconds(6))
        const sql = yield* SqlClient.SqlClient
        const [call] = yield* until(
          sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${task.taskId} AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.include(call?.payload ?? '', 'Wait expired: Merge the backlog')
        assert.lengthOf(yield* turns(task.threadId), 1)
      }).pipe(
        Effect.provide(
          withQueries(':memory:', { holds: gate }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
        ),
      ),
    )
  })

  it.effect('keeps a wait and its deadline across a clean restart, then reconciles a condition met while offline', () => {
    const gate = holds()
    const database = join(mkdtempSync(join(tmpdir(), 'althar-wait-')), 'profile.sqlite')
    const keychain = new Map<string, string>()
    return onTestClock(
      Effect.gen(function* () {
        const task = yield* Effect.scoped(
          Effect.gen(function* () {
            const task = yield* planned(repository())
            const at = new Date((yield* Clock.currentTimeMillis) + 10_000).toISOString()
            yield* callTool(task.access, 'wait_for', {
              reason: 'Continue after restart',
              timeout_seconds: 60,
              conditions: [{ kind: 'time', at }],
            })
            gate.open('[lead:slowly]')
            yield* idle(task.threadId)
            const [wait] = yield* held(task.taskId)
            return { ...task, deadline: externalWaitOf(wait?.output ?? null)?.deadline }
          }).pipe(Effect.provide(withQueries(database, { holds: gate }, { keychain }))),
        )
        yield* TestClock.adjust(Duration.seconds(15))
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* ready(task.projectId, task.taskId)
            assert.lengthOf(yield* held(task.taskId), 0)
            assert.lengthOf(yield* turns(task.threadId), 2)
          }).pipe(Effect.provide(withQueries(database, { holds: gate }, { keychain }))),
        )
      }),
    )
  })
})
