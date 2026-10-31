import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, hosted, items, notices, runtime, until } from './support'

/*
 * A task's own step that opens its pull request, where changes.test.ts and
 * rounds.test.ts don't go: the host refusing to open it, at once or once the
 * person stopped the task, a round of work after its pull request was
 * closed, and a task that follows a pull request it didn't open.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

const runtimeWith = (github: FakeService, more: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), ...more })),
  )

/** A repository on the fake GitHub, taking what is pushed in a bare repository; its lead commits as the person does. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const connect = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
})

/** A task in the project, planned for Codex alone as its description says, ending in a draft pull request, and started now. */
const started = (projectId: string, description: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'Add a retry',
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: 'draft',
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return task
  })

/** A connected GitHub, the repository opened as a project, and a task in it as above. */
const publishing = (working: string, description = 'Add a retry. [lead:finish] [lead:edit]') =>
  Effect.gen(function* () {
    yield* connect
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    return { projectId: project.projectId, ...(yield* started(project.projectId, description)) }
  })

/** What publishing said in the thread, in order. */
const published = (threadId: string) =>
  Effect.map(items(threadId), (all) =>
    all.flatMap((item) => (item.kind === 'step_result' && item.content.step === 'publish' ? [String(item.content.summary)] : [])),
  )

/** The task's open call for a step that needs the person: its id, and what it says. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
    )
    return { id: call?.id ?? '', ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string; detail: string | null }) }
  })

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

/** The fake GitHub, its first `times` openings failing as given, and how many it was asked for. */
const failing = (github: FakeService, times: number, reason: ConnectorFailed['reason'], status?: number) => {
  const asked = { count: 0 }
  const service: FakeService = {
    ...github,
    openChange: (repository, change) =>
      Effect.suspend(() => {
        asked.count += 1
        return asked.count <= times
          ? Effect.fail(
              new ConnectorFailed({ product: 'github', reason, message: 'The host failed', ...(status === undefined ? {} : { status }) }),
            )
          : github.openChange(repository, change)
      }),
  }
  return { service, asked }
}

describe('opening a task’s pull request when the host fails', () => {
  it.live('tries again once by itself where the failure may pass, and asks nothing when that opens it', () => {
    const { working, github } = onGitHub()
    const { service, asked } = failing(github, 1, 'unreachable', 502)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* publishing(working)
      yield* until(published(task.threadId), (said) => said.length === 1)
      assert.deepStrictEqual(yield* published(task.threadId), ['Opened draft pull request #1.'])
      assert.strictEqual(asked.count, 2)
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck'`, 0)
      assert.deepStrictEqual(yield* runsOf(task.taskId), [{ state: 'succeeded' }])
    }).pipe(Effect.provide(runtimeWith(service)))
  })

  it.live('needs the person when the try again fails too', () => {
    const { working, github } = onGitHub()
    const { service, asked } = failing(github, 2, 'rate_limited', 429)
    return Effect.gen(function* () {
      const task = yield* publishing(working)
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['publish', 'failed_to_start'])
      assert.strictEqual(asked.count, 2)
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(runtimeWith(service)))
  })

  it.live('needs the person at once where the failure won’t pass', () => {
    const { working, github } = onGitHub()
    const { service, asked } = failing(github, 1, 'forbidden', 403)
    return Effect.gen(function* () {
      const task = yield* publishing(working)
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['publish', 'failed_to_start'])
      assert.strictEqual(asked.count, 1)
    }).pipe(Effect.provide(runtimeWith(service)))
  })
})

describe('opening a task’s pull request', () => {
  it.live('needs the person when the host refuses it, and opens it when they say to try again', () => {
    const { working, github } = onGitHub()
    github.failNext('openChange', 'rejected', undefined, 422)
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* publishing(working)
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['publish', 'failed_to_start'])
      assert.include(call.detail, 'The fake openChange failed (rejected)')
      assert.lengthOf(github.changes, 0)
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call.id,
        answer: { kind: 'retry', agentId: 'codex' },
      })
      assert.deepStrictEqual(yield* published(task.threadId), ['Opened draft pull request #1.'])
      assert.lengthOf(github.changes, 1)
      assert.deepStrictEqual(yield* runsOf(task.taskId), [{ state: 'succeeded' }])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('asks nothing of the person when the host refuses it after they stopped the task, and opens it once resumed', () => {
    const { working, github } = onGitHub()
    const gate = Deferred.makeUnsafe<void>()
    let refused = false
    // The first time, the host refuses to open it, once the test lets the answer go.
    const refusing: FakeService = {
      ...github,
      openChange: (repository, change) =>
        refused
          ? github.openChange(repository, change)
          : Effect.andThen(
              Deferred.await(gate),
              Effect.suspend(() => {
                refused = true
                return Effect.fail(
                  new ConnectorFailed({ product: 'github', reason: 'rejected', status: 422, message: 'Validation failed' }),
                )
              }),
            ),
    }
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tasks = yield* Tasks
      const task = yield* publishing(working)
      yield* until(
        sql<{ id: string }>`
          SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'publish' AND a.state = 'running'`,
        (rows) => rows.length === 1,
      )
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      yield* Deferred.succeed(gate, undefined)
      yield* until(
        Effect.sync(() => (refused ? [refused] : [])),
        (rows) => rows.length === 1,
      )
      yield* Effect.sleep('300 millis')
      // They stopped it: nothing asks them, and the run waits to be resumed.
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck'`, 0)
      assert.deepStrictEqual(yield* runsOf(task.taskId), [{ state: 'suspended' }])
      yield* tasks.resume({ envelope: yield* Runtime.envelope('task.resume', {}), taskId: task.taskId })
      yield* until(published(task.threadId), (said) => said.length === 1)
      assert.deepStrictEqual(yield* published(task.threadId), ['Opened draft pull request #1.'])
      assert.deepStrictEqual(yield* runsOf(task.taskId), [{ state: 'succeeded' }])
    }).pipe(Effect.provide(runtimeWith(refusing, { stopGrace: Duration.millis(300) })))
  })

  it.live('opens a round of work after its pull request was closed in a new one by itself, a draft (ADR-078)', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const changes = yield* Changes
      const task = yield* publishing(working)
      yield* until(published(task.threadId), (said) => said.length === 1)
      github.close(1)
      yield* changes.refresh(task.taskId)
      yield* until(
        Effect.map(items(task.threadId), (all) => all.filter((item) => item.kind === 'arrival' && item.content.kind === 'closed')),
        (closed) => closed.length === 1,
      )
      // The person asks its lead for more, which it commits: a round of work of its own, whose commits open the next pull request.
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: task.threadId,
        body: 'Retry twice. [lead:finish] [lead:edit]',
      })
      yield* until(runsOf(task.taskId), (runs) => runs.length === 2 && runs[1]?.state === 'succeeded')
      yield* until(published(task.threadId), (said) => said.length === 2)
      assert.lengthOf(github.changes, 2)
      assert.isTrue(github.changes[1]?.draft)
      // Opened, nothing says it isn't in one.
      assert.notInclude(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        "What the follow-up committed isn't in a pull request yet.",
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('pushes onto the pull request a task follows, and says so, opening no other', () => {
    const { working, bare } = hosted(['you', 'api'])
    git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
    git(working, 'checkout', '-q', '-b', 'fix-send-back')
    writeFileSync(join(working, 'send.ts'), 'export const sendBack = () => 1\n')
    git(working, 'add', 'send.ts')
    git(working, 'commit', '-q', '-m', 'Send back')
    const head = git(working, 'rev-parse', 'HEAD')
    git(working, 'push', '-q', bare, 'fix-send-back')
    git(working, 'checkout', '-q', 'main')
    git(working, 'branch', '-q', '-D', 'fix-send-back')
    const tip = () => git(bare, 'rev-parse', 'refs/heads/fix-send-back')
    const github = makeFakeService({ pushUrl: () => bare, headOf: (number) => (number === 1 ? tip() : null) })
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    const pull = github.addPullRequest({
      path: ['meridian', 'api'],
      title: 'Send back',
      author: 'you',
      source: 'fix-send-back',
      headSha: head,
      fork: ['you', 'api'],
    })
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      const instance = yield* Instance
      yield* connect
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const [repository] = yield* projects.repositories(project.projectId)
      yield* projects.setRepository({ projectId: project.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
      const draft = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Answer the review',
        description: 'Answer it. [lead:finish] [lead:edit]',
      })
      yield* changes.attach({
        taskId: draft.taskId,
        pullRequest: `${HOST}/meridian/api/pull/${pull.number}`,
        start: true,
        actorId: instance.personId,
      })
      const plans = yield* Plans
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: draft.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: 'draft',
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const [said] = yield* until(published(draft.threadId), (all) => all.length === 1)
      assert.strictEqual(said, 'Pushed to pull request #1, which the task follows.')
      assert.lengthOf(github.changes, 1)
      assert.strictEqual(tip(), git(draft.worktree, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
