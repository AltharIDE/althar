import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { OutwardUncertain } from '../src/errors'
import { Instance } from '../src/Instance'
import { outward } from '../src/outward'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * The edges of reaching code hosts and trackers: an outward action's receipt
 * across retries and lost answers; listening that is told to wait, or hears
 * a pull request closed or made ready by hand; and the tools as agents call
 * them, refusing in words what they can't do.
 */

const runtimeWith = (services: { readonly github?: FakeService; readonly linear?: FakeService }, listenEvery = Duration.millis(100)) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services), listenEvery })))

const connect = (product: 'github' | 'linear', webUrl?: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product, token: 't', actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) })
  })

/** A project on the hosted repository, with a task whose pull request is open and listened to. */
const withPullRequest = (github: FakeService, bare: string, working: string) =>
  Effect.gen(function* () {
    yield* connect('github', HOST)
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const queries = yield* Queries
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const cards = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
    )
    const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0].change !== null, Duration.seconds(20))
    void bare
    return { projectId: project.projectId as ProjectId, taskId: ready?.taskId ?? '', threadId: ready?.threadId ?? '', cards }
  })

const arrivals = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'arrival').map((item) => item.content))

describe('an outward action', () => {
  const action = (perform: Effect.Effect<string, ConnectorFailed>, more: { readonly retryable?: boolean; readonly key?: string } = {}) =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const [project] = yield* Effect.map(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: ProjectId }>`SELECT id FROM projects LIMIT 1`
        }),
        (rows) => rows,
      )
      const projectId =
        project?.id ??
        ((yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted().working })).projectId as ProjectId)
      return yield* outward({
        projectId,
        subject: { type: 'task', id: 'x' },
        target: 'github:meridian/api',
        operation: 'reply',
        key: more.key ?? 'reply:x',
        request: { body: 'hi' },
        retryable: more.retryable ?? false,
        perform,
        encode: (answer) => answer,
        decode: (kept) => (typeof kept === 'string' ? kept : undefined),
      })
    })

  it.live('is done once: asked again, its confirmed answer comes back without calling', () =>
    Effect.gen(function* () {
      let calls = 0
      const call = Effect.sync(() => `answer ${(calls += 1)}`)
      assert.strictEqual(yield* action(call), 'answer 1')
      assert.strictEqual(yield* action(call), 'answer 1')
      assert.strictEqual(calls, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is tried again after a refusal, and stays uncertain after a lost answer unless trying again is safe', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const refused = new ConnectorFailed({ product: 'github', reason: 'rejected', message: 'No' })
      const error = yield* Effect.flip(action(Effect.fail(refused), { key: 'a' }))
      assert.strictEqual(error instanceof ConnectorFailed ? error.reason : '', 'rejected')
      assert.strictEqual(yield* action(Effect.succeed('then yes'), { key: 'a' }), 'then yes')

      const lost = new ConnectorFailed({ product: 'github', reason: 'unreachable', message: 'Timed out' })
      yield* Effect.flip(action(Effect.fail(lost), { key: 'b' }))
      const [receipt] = yield* sql<{ state: string }>`SELECT state FROM mutation_receipts WHERE idempotency_key = 'b'`
      assert.strictEqual(receipt?.state, 'uncertain')
      assert.instanceOf(yield* Effect.flip(action(Effect.succeed('again'), { key: 'b' })), OutwardUncertain)
      assert.strictEqual(yield* action(Effect.succeed('again'), { key: 'b', retryable: true }), 'again')

      // A confirmed answer the record can't read back is uncertain, not invented.
      yield* sql`UPDATE mutation_receipts SET response = '42' WHERE idempotency_key = 'a'`
      assert.instanceOf(yield* Effect.flip(action(Effect.succeed('x'), { key: 'a' })), OutwardUncertain)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('listening', () => {
  it.live('waits as long as the host says, hears a pull request made ready or closed by hand, and stops', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { threadId, cards } = yield* withPullRequest(github, bare, working)
      const changes = yield* Changes
      // Told to wait a minute, it doesn't ask again until then, even asked to.
      github.failNext('change', 'rate_limited', new Date(Date.now() + 60_000).toISOString())
      yield* Effect.sleep('300 millis')
      const asked = github.calls.filter((call) => call === 'change').length
      yield* Effect.sleep('300 millis')
      assert.strictEqual(github.calls.filter((call) => call === 'change').length, asked)
      // Asked about its own task, it asks the host at once.
      github.readyByHand(1)
      const { taskId } = yield* Effect.map(cards, (all) => ({ taskId: all[0]?.taskId ?? '' }))
      yield* changes.refresh(taskId)
      yield* until(arrivals(threadId), (all) => all.some((arrival) => arrival.kind === 'ready'))
      // A review that approves arrives; it isn't the lead's to answer.
      github.reviewAs(1, 'dana', 'approved', 'Ship it.')
      yield* changes.refresh(taskId)
      yield* until(arrivals(threadId), (all) => all.some((arrival) => arrival.kind === 'review'))
      github.close(1)
      yield* changes.refresh(taskId)
      yield* until(arrivals(threadId), (all) => all.some((arrival) => arrival.kind === 'closed'))
      const [card] = yield* cards
      assert.strictEqual(card?.change?.state, 'closed')
      assert.isFalse(card?.change?.listening)
      assert.notStrictEqual(card?.phase, 'settled', 'a closed pull request leaves the task as it was')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('keeps going when the host fails, and goes quiet when the connection is removed', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { threadId, taskId } = yield* withPullRequest(github, bare, working)
      const changes = yield* Changes
      const connections = yield* Connections
      const instance = yield* Instance
      github.failNext('activity', 'unreachable')
      yield* changes.refresh(taskId)
      yield* Effect.sleep('200 millis')
      const [connection] = yield* connections.list
      yield* connections.remove(connection?.id ?? '', instance.personId)
      github.commentAs(1, 'dana', 'Anyone there?')
      yield* changes.refresh(taskId)
      yield* Effect.sleep('400 millis')
      assert.lengthOf(yield* arrivals(threadId), 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('the tools, as agents call them', () => {
  it.live('refuse in words what a lead can’t do, and read an issue for a lead or a reviewer', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Refunds ignore the limit', body: 'They do.' })
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* withPullRequest(github, bare, working)
      const lead = { role: 'lead' as const, projectId, threadId, sessionId: 'none', taskId }
      assert.match(yield* callTool(lead, 'read_pull_request', {}), /^PR #1, "Add a retry" \(draft\)/)
      assert.match(yield* callTool(lead, 'reply_on_pull_request', { body: 7 }), /couldn't read that/)
      assert.strictEqual(yield* callTool(lead, 'reply_on_pull_request', { body: 'On it.', thread_id: null }), 'Replied on PR #1.')

      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      // Pushing is the person's: the lead has no tool for it.
      assert.match(yield* callTool(lead, 'publish_changes', {}), /^Althar has no tool called publish_changes/)
      writeFileSync(join(workspace?.path ?? '', 'loose.txt'), 'not committed\n')
      execFileSync('git', ['add', '-A'], { cwd: workspace?.path })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-qm', 'Loose'], { cwd: workspace?.path })
      const changes = yield* Changes
      yield* changes.push(taskId, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace?.path }).toString().trim())

      // Publishing asked the host for news at once; once that's done, the next read is the tool's.
      yield* Effect.sleep('500 millis')
      github.failNext('change', 'forbidden')
      assert.match(yield* callTool(lead, 'read_pull_request', {}), /^The code host said: The fake change failed/)

      assert.match(yield* callTool(lead, 'read_issue', { issue: '#12' }), /^#12: Refunds ignore the limit\n\nTodo, in meridian\/api\./)
      assert.match(yield* callTool({ ...lead, role: 'reviewer' }, 'read_issue', { issue: 'meridian/api#99' }), /can’t read that issue/)
      assert.match(yield* callTool({ ...lead, taskId: null }, 'read_pull_request', {}), /for a task’s lead/)

      // The coordinator reads and finds issues, and drafts from one it can read.
      const coordinator = { role: 'coordinator' as const, projectId, threadId: 'none', sessionId: 'coordinator-session', taskId: null }
      assert.match(yield* callTool(coordinator, 'read_issue', { issue: 'https://github.test/meridian/api/issues/12' }), /^#12: Refunds/)
      assert.match(yield* callTool(coordinator, 'read_issue', { issue: 'MER-1' }), /can't read MER-1/)
      assert.match(yield* callTool(coordinator, 'find_issues', {}), /^- #12: Refunds ignore the limit \(Todo\)/)
      assert.match(yield* callTool(coordinator, 'draft_task', { title: 'Fix it', issue: 'MER-404' }), /can't read MER-404/)
      assert.match(
        yield* callTool(coordinator, 'draft_task', { title: 'Fix the limit', issue: '#12' }),
        /^Drafted fix-the-limit, from #12\./,
      )

      // Removed, the connection reaches nothing: the lead is told so.
      const connections = yield* Connections
      const instance = yield* Instance
      const [connection] = yield* connections.list
      yield* connections.remove(connection?.id ?? '', instance.personId)
      assert.match(yield* callTool(lead, 'read_pull_request', {}), /isn’t connected to this repository’s host/)
      assert.match(yield* callTool(coordinator, 'find_issues', {}), /no open issues/)
      // Listening waits an hour here, so nothing else asks the fake meanwhile.
    }).pipe(Effect.provide(runtimeWith({ github }, Duration.hours(1))))
  })

  it.live('tell a lead whose task has no pull request yet that Althar opens one', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'x',
      })
      const lead = {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      assert.match(yield* callTool(lead, 'read_pull_request', {}), /no pull request yet/)
    }).pipe(Effect.provide(runtimeWith({})))
  })
})
