import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A task's pull request at its edges. The lead's tools for it: what people
 * said read in the order they said it; a pull request it names that the task
 * hasn't; a check with a short log or none at all; a reply whose earlier
 * answer was lost, or with no lead running; a fix that couldn't go up alone;
 * a push from a worktree that isn't on this computer. The person's own acts
 * on it: merging it here, its branch gone, a merge the host made first. And
 * an abandoned task's that merges after all, and one heard across a restart.
 */

/** Listening waits an hour unless a test says, so nothing but the tools asks the fake meanwhile. */
const runtimeWith = (github: FakeService, listenEvery = Duration.hours(1)) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery })))

/** Where the host reads the task's branch: where the bare repository has it. */
const tipOf = (bare: string) => () => {
  try {
    return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
  } catch {
    return null
  }
}

/** A task whose pull request is open, once its card is ready or, with `opened`, as soon as the pull request is: its lead's access to its tools, and its worktree. */
const withPullRequest = (working: string, opened = false) =>
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
    const [ready] = yield* until(cards, (all) => (opened || all[0]?.phase === 'ready') && all[0]?.change != null, Duration.seconds(20))
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

describe('a lead’s pull request tools, at their edges', () => {
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

  it.live('read what people said in the order they said it, a comment before a review', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working)
      github.commentAs(1, 'dana', 'Is it seconds?')
      github.reviewAs(1, 'dana', 'changes_requested', 'Make it seconds.')
      const read = yield* callTool(lead, 'read_pull_request', {})
      const comment = read.indexOf('Is it seconds?')
      const review = read.indexOf('Make it seconds.')
      assert.isAbove(comment, -1)
      assert.isAbove(review, comment)
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
      // With no lead running, it says only that it came from Althar.
      yield* (yield* Sessions).stop(lead.threadId)
      assert.strictEqual(yield* callTool(lead, 'reply_on_pull_request', { body: 'Seconds, everywhere.' }), 'Replied on PR #1.')
      assert.include(
        github.commentsOn(1).map((comment) => comment.body),
        'Seconds, everywhere.\n\n<sub>From Althar.</sub>',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('ask the person to push a fix for failed checks where pushing it alone was refused', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts' }],
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead, worktree, taskId } = yield* withPullRequest(working, true)
      // Its checks failed before the person saw it, and again once run again: a fix would go up alone, but the remote now turns
      // pushes down.
      yield* until((yield* Changes).ofTask(taskId), (all) => all[0]?.checks?.outcome === 'failed')
      const tried = join(bare, 'tried')
      const hook = join(bare, 'hooks', 'pre-receive')
      writeFileSync(hook, `#!/bin/sh\ntouch '${tried}'\nexit 1\n`)
      chmodSync(hook, 0o755)
      writeFileSync(join(worktree, 'fixed.txt'), 'fixed\n')
      execFileSync('git', ['add', '-A'], { cwd: worktree })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-qm', 'Fix the test'], { cwd: worktree })
      assert.match(yield* callTool(lead, 'push_to_pull_request', {}), /^Asked the person to push 1 commit to PR #1\./)
      // It was tried alone first.
      assert.isTrue(existsSync(tried))
    }).pipe(Effect.provide(runtimeWith(github, Duration.millis(100))))
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

describe('an abandoned task’s pull request that merges after all', () => {
  it.live('leaves the task abandoned, without a word, where it has commits after what merged', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead, worktree, taskId } = yield* withPullRequest(working)
      const changes = yield* Changes
      const sql = yield* SqlClient.SqlClient
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId }), taskId })
      // Its pull request left open, as an older Althar left it: not listened to.
      yield* sql`UPDATE external_links SET listening = 0 WHERE task_id = ${taskId} AND kind = 'change'`
      // A commit after it, then someone merges it on the host.
      writeFileSync(join(worktree, 'after.txt'), 'after\n')
      execFileSync('git', ['add', '-A'], { cwd: worktree })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-qm', 'After'], { cwd: worktree })
      github.mergeByHand(1)
      yield* changes.readSettled
      assert.strictEqual((yield* changes.ofTask(taskId))[0]?.state, 'merged')
      const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
      assert.strictEqual(task?.state, 'abandoned')
      const said = (yield* items(lead.threadId)).filter((item) => item.kind === 'notice').map((item) => String(item.content.title))
      assert.isFalse(said.some((title) => title.startsWith('Not done yet')))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s pull request across a restart', () => {
  it.live('is listened to again at the next launch, and what was said on it meanwhile arrives', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    const database = join(mkdtempSync(join(tmpdir(), 'althar-db-')), 'profile.sqlite')
    const launch = (every: Duration.Duration) =>
      Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { connectors: fakeConnectors({ github }), listenEvery: every })))
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working).pipe(Effect.provide(launch(Duration.hours(1))))
      // Said while Althar was closed.
      github.commentAs(1, 'dana', 'Is it seconds?')
      yield* Effect.gen(function* () {
        const arrivals = Effect.map(items(lead.threadId), (all) => all.filter((item) => item.kind === 'arrival'))
        const [heard] = yield* until(arrivals, (all) => all.length > 0, Duration.seconds(10))
        assert.deepInclude(heard?.content, { kind: 'comment', from: 'dana' })
      }).pipe(Effect.provide(launch(Duration.millis(100))))
    })
  })
})

describe('rerun_check, on the task’s own pull request', () => {
  it.live('runs the failed checks again, or the one named, and says which can’t be run again here, with where the person can', () => {
    const { working, bare } = hosted()
    let checks: Parameters<FakeService['setChecks']>[1] = []
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => checks })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { lead, taskId } = yield* withPullRequest(working)
      assert.strictEqual(
        yield* callTool(lead, 'rerun_check', {}),
        "None of PR #1's checks failed, so there's nothing to run again. Name one with check to run it again all the same.",
      )
      checks = [
        { name: 'test', state: 'failed', log: 'FAIL limit.test.ts' },
        { name: 'Workers Builds: meridian', state: 'failed', url: 'https://dash.cloudflare.com/builds/7', rerun: false },
        { name: 'lint', state: 'passed' },
        { name: 'e2e', state: 'running' },
      ]
      // Each that failed: the GitHub Actions job runs again; the build another service reported is the person's to run, from its page.
      assert.strictEqual(
        yield* callTool(lead, 'rerun_check', {}),
        [
          "Running test on PR #1 again. If it fails again, you'll be told, as for any checks; read_pull_request shows how it goes meanwhile.",
          "Workers Builds: meridian can't be run again here: only a GitHub Actions job runs again from Althar, and it comes from another service. The person can run it again from its page: https://dash.cloudflare.com/builds/7",
        ].join('\n\n'),
      )
      assert.lengthOf(github.reruns, 1)
      // The thread says so, and its outcome is heard afresh, as a rerun's.
      const notices = Effect.map(items(lead.threadId), (rows) =>
        rows.flatMap((row) => (row.kind === 'notice' ? [String(row.content.title)] : [])),
      )
      assert.include(yield* notices, 'Running test on PR #1 again, as its lead asked.')
      const sql = yield* SqlClient.SqlClient
      const kept = yield* sql<{ id: string }>`
        SELECT json_extract(o.payload, '$.id') AS id FROM observations o JOIN external_links l ON l.id = o.subject_id
        WHERE l.task_id = ${taskId} AND o.kind = 'checks_rerun'`
      assert.match(kept[0]?.id ?? '', /^rerun:[0-9a-f]+:1$/)

      // One named, passed or not; one still running has nothing to run again; one it hasn't is said with those it has.
      assert.match(yield* callTool(lead, 'rerun_check', { check: 'LINT' }), /^Running lint on PR #1 again\./)
      assert.lengthOf(github.reruns, 2)
      assert.strictEqual(
        yield* callTool(lead, 'rerun_check', { check: 'e2e' }),
        "e2e on PR #1 is still running, so there's nothing to run again yet.",
      )
      assert.strictEqual(
        yield* callTool(lead, 'rerun_check', { check: 'deploy' }),
        'PR #1 has no check called "deploy". Its checks: test, Workers Builds: meridian, lint, e2e.',
      )
      assert.strictEqual(
        yield* callTool(lead, 'rerun_check', { pull_request: 'web#3' }),
        "This task's pull requests are api#1. Name one of those.",
      )
      // The host's refusal, in its words.
      checks = [
        {
          name: 'test',
          state: 'failed',
          rerun: new ConnectorFailed({ product: 'github', reason: 'forbidden', status: 403, message: 'Must have admin rights' }),
        },
      ]
      assert.strictEqual(yield* callTool(lead, 'rerun_check', {}), 'GitHub refused to run test again: Must have admin rights')
      assert.lengthOf(github.reruns, 2)
      // Only a task's lead has a pull request of its own.
      assert.strictEqual(yield* callTool({ ...lead, taskId: null }, 'rerun_check', {}), 'This tool is for a task’s lead.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('hears how checks the lead ran again end, after Althar’s own run again: a failure again is told afresh', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts' }],
    })
    github.addRepository(['meridian', 'api'])
    const failures = (threadId: string) =>
      Effect.map(items(threadId), (rows) => rows.filter((row) => row.kind === 'arrival' && row.content.kind === 'checks'))
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working, true)
      // Failed, run again once by Althar, failed again: two arrivals.
      yield* until(failures(lead.threadId), (heard) => heard.length === 2 && github.reruns.length === 1, Duration.seconds(30))
      assert.match(yield* callTool(lead, 'rerun_check', { check: 'test' }), /^Running test on PR #1 again\./)
      // Run again by the lead, it shows running, then fails: heard again, as its own.
      yield* until(failures(lead.threadId), (heard) => heard.length === 3, Duration.seconds(30))
      assert.lengthOf(github.reruns, 2)
    }).pipe(Effect.provide(runtimeWith(github, Duration.millis(100))))
  })
})
