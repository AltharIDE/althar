import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A lead's tools for its task's pull request, where what it asks for isn't
 * there to be had: a pull request it names that the task hasn't, a check
 * with a short log or none at all, a reply whose earlier answer was lost, and
 * a push from a worktree that isn't on this computer. And the person's own
 * acts on it: merging it here, its branch gone, a merge the host made first.
 */

/** Listening waits an hour, so nothing but the tools asks the fake meanwhile. */
const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

/** Where the host reads the task's branch: where the bare repository has it. */
const tipOf = (bare: string) => () => {
  try {
    return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
  } catch {
    return null
  }
}

/** A task whose pull request is open, its lead's access to its tools, and its worktree. */
const withPullRequest = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
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
    const taskId = ready?.taskId ?? ''
    const lead: ToolAccess = {
      role: 'lead',
      projectId: project.projectId as ProjectId,
      threadId: ready?.threadId ?? '',
      sessionId: 'none',
      taskId,
    }
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
    return { lead, worktree: workspace?.path ?? '', taskId }
  })

describe('a lead’s pull request tools, where what it asks for isn’t there', () => {
  it.live('read a check’s log on the pull request named, a short one whole, and say where there are no checks', () => {
    const { working, bare } = hosted()
    let checks: Parameters<FakeService['setChecks']>[1] = []
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => checks })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working)
      // One the task hasn't: its own are named.
      assert.strictEqual(
        yield* callTool(lead, 'read_check_log', { check: 'test', pull_request: 'web#3' }),
        "This task's pull requests are api#1. Name one of those.",
      )
      // None ran.
      assert.strictEqual(yield* callTool(lead, 'read_check_log', { check: 'test' }), 'PR #1 has no check called "test". Its checks: none.')
      // A log short enough to read in one page is read whole, with no page before or after; by its repository and number, or its path.
      checks = [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts\n  expected 429\n' }]
      const whole = "Lines 1 to 2 of 2 of test's log on PR #1:\n```\nFAIL limit.test.ts\n  expected 429\n```"
      assert.strictEqual(yield* callTool(lead, 'read_check_log', { check: 'test', pull_request: 'api#1' }), whole)
      assert.strictEqual(yield* callTool(lead, 'read_check_log', { check: 'test', pull_request: 'Meridian/API#1' }), whole)
      assert.strictEqual(yield* callTool(lead, 'read_check_log', { check: 'test', pull_request: 1 }), whole)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('post a reply whose answer was lost only once: asked again, it says to try again or tell the person', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working)
      github.failNext('reply', 'unreachable')
      assert.strictEqual(
        yield* callTool(lead, 'reply_on_pull_request', { body: 'Seconds, as charges.' }),
        'The code host said: The fake reply failed (unreachable)',
      )
      // It may be on the pull request already: the same reply isn't posted again.
      assert.strictEqual(
        yield* callTool(lead, 'reply_on_pull_request', { body: 'Seconds, as charges.' }),
        'Althar could not do that. Try again, or tell the person.',
      )
      assert.lengthOf(
        github.commentsOn(1).filter((comment) => comment.body.startsWith('Seconds, as charges.')),
        0,
      )
      // Another reply goes up as ever.
      assert.strictEqual(yield* callTool(lead, 'reply_on_pull_request', { body: 'In seconds.' }), 'Replied on PR #1.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('ask for no push from a worktree that isn’t on this computer', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead, worktree } = yield* withPullRequest(working)
      rmSync(worktree, { recursive: true, force: true })
      assert.strictEqual(
        yield* callTool(lead, 'push_to_pull_request', {}),
        "The task's worktree isn't on this computer, so Althar can't see what is on its branch. Tell the person.",
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s pull request, as the person acts on it', () => {
  it.live('isn’t merged here, says where its branch can’t be fetched, and settles once merged on the host before Merge was pressed', () => {
    const { working, bare } = hosted()
    const tip = tipOf(bare)
    const github = makeFakeService({ pushUrl: () => bare, headOf: tip })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { worktree, taskId } = yield* withPullRequest(working)
      const changes = yield* Changes
      const sql = yield* SqlClient.SqlClient
      const [binding] = yield* sql<{ slug: string }>`
        SELECT b.slug FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${taskId}`
      const head = tip() ?? ''
      // It merges through its pull request, not here.
      const here = yield* Effect.flip(changes.mergeHere(taskId, [{ repository: binding?.slug ?? '', head }]))
      assert.deepStrictEqual([(here as { _tag?: string })._tag, (here as { why?: string }).why], ['CantMerge', 'pull_request'])
      // Its branch gone from the host, there's nothing to fetch to merge into it.
      const kept = execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
      execFileSync('git', ['update-ref', '-d', 'refs/heads/althar/add-a-retry'], { cwd: bare })
      const unfetched = yield* Effect.flip(changes.mergeNote(taskId))
      assert.strictEqual((unfetched as { stderr?: string }).stderr, "Couldn't fetch althar/add-a-retry from the host.")
      execFileSync('git', ['update-ref', 'refs/heads/althar/add-a-retry', kept], { cwd: bare })
      // Someone merged it on the host before the person pressed Merge: nothing is merged twice, and the task settles.
      github.mergeByHand(1)
      yield* changes.merge(taskId, head)
      assert.notInclude(github.calls, 'merge')
      const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
      assert.strictEqual(task?.state, 'done')
      assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree }).toString().trim(), kept)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
