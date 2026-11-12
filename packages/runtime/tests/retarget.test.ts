import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A running task changes the branch it works toward (a task is a conversation
 * plus parts, "Changing the branch a task works toward"): nothing pushed, its
 * branch is rebased onto the new one; pushed, its own commits go onto a fresh
 * branch from it, whose pull request opens into it; held for Ship, that waits
 * for Ship.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
const as = ['-c', 'user.name=Person', '-c', 'user.email=person@althar.test']

/** A repository on GitHub with a release branch a commit past main. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'switch', '-q', '-c', 'release/0.8.0')
  writeFileSync(join(working, 'RELEASE.md'), '0.8.0\n')
  git(working, 'add', 'RELEASE.md')
  git(working, ...as, 'commit', '-q', '-m', 'Release notes')
  // On the host (the bare copy pushes go to), and as this clone last fetched it.
  git(working, 'push', '-q', bare, 'release/0.8.0')
  git(working, 'update-ref', 'refs/remotes/origin/release/0.8.0', 'release/0.8.0')
  git(working, 'switch', '-q', 'main')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const opened = (working: string, markers = '[coordinator:plan-no-review]') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] ${markers} [lead:finish] [lead:edit]`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    const [first] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return {
      projectId: project.projectId,
      taskId: card.taskId,
      threadId: card.threadId,
      path: first?.path ?? '',
      lead: {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: card.threadId,
        sessionId: lead?.id ?? '',
        taskId: card.taskId,
      },
    }
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ path: string; branch: string; toward: string | null; name: string | null; heldAt: string | null }>`
      SELECT path, branch, toward, name, held_at FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

describe('changing the branch a running task works toward', () => {
  it.live('rebases a change nothing of which was pushed onto the new branch', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = (yield* workspacesOf(task.taskId))[1] ?? assert.fail('no change')
      writeFileSync(join(docs.path, 'docs.md'), 'how it retries\n')
      git(docs.path, 'add', 'docs.md')
      git(docs.path, ...as, 'commit', '-q', '-m', 'Docs')
      const said = yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0', change: 'Docs' })
      assert.include(said, 'works toward release/0.8.0 now: its 1 commit rebased onto it.')
      const after = (yield* workspacesOf(task.taskId))[1]
      assert.strictEqual(after?.toward, 'release/0.8.0')
      assert.strictEqual(after?.branch, docs.branch)
      // On the release branch now, its own commit on top.
      assert.strictEqual(git(docs.path, 'log', '--format=%s', '-2'), 'Docs\nRelease notes')
      // The task's first change, pushed, stays where it was.
      assert.strictEqual((yield* workspacesOf(task.taskId))[0]?.toward, null)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves a change already pushed onto a fresh branch from the new one, whose pull request opens into it', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const before = (yield* workspacesOf(task.taskId))[0] ?? assert.fail('no workspace')
      const said = yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0' })
      assert.include(said, `works toward release/0.8.0 now, on ${before.branch}-2`)
      assert.include(said, 'PR #1 still goes into main: close it once the new one is open.')
      const after = (yield* workspacesOf(task.taskId))[0]
      assert.strictEqual(after?.branch, `${before.branch}-2`)
      assert.strictEqual(after?.toward, 'release/0.8.0')
      // Its own commits, cherry-picked onto the release branch.
      assert.include(git(task.path, 'log', '--format=%s'), 'Release notes')
      // Its new pull request opens into the release branch; the old one is left open, followed no more.
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.target], [`${before.branch}-2`, 'release/0.8.0'])
      assert.strictEqual(github.changes[0]?.state, 'open')
      const sql = yield* SqlClient.SqlClient
      const [old] = yield* sql<{ listening: number }>`SELECT listening FROM external_links WHERE url = ${github.changes[0]?.url ?? ''}`
      assert.strictEqual(old?.listening, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps a tweak that waits for Ship held on the fresh branch, which only Ship opens', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const sessions = yield* Sessions
      const body = 'Make it retry twice. [lead:commit]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* until(workspacesOf(task.taskId), (rows) => rows[0]?.heldAt != null)
      yield* until(
        Effect.flatMap(Sessions, (all) => all.busy(task.threadId)),
        (busy) => !busy,
      )
      const before = (yield* workspacesOf(task.taskId))[0] ?? assert.fail('no workspace')
      yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0' })
      const after = (yield* workspacesOf(task.taskId))[0]
      assert.strictEqual(after?.branch, `${before.branch}-2`)
      assert.isNotNull(after?.heldAt ?? null)
      // Nothing opened, nothing pushed: it waits for Ship.
      assert.lengthOf(github.changes, 1)
      assert.throws(() => git(bare, 'rev-parse', '--verify', `${before.branch}-2`))
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.target], [`${before.branch}-2`, 'release/0.8.0'])
      assert.include(git(bare, 'log', '--format=%s', `${before.branch}-2`), 'Release notes')
      assert.isTrue((yield* notices(task.threadId)).some((title) => title.includes('PR #1 still goes into main')))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves the mark of what its review read with its commits, so the next review reads only what came since', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]')
      const sessions = yield* Sessions
      const body = 'Make it retry twice. tidy pls [lead:commit]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* until(workspacesOf(task.taskId), (rows) => rows[0]?.heldAt != null)
      yield* until(
        Effect.flatMap(Sessions, (all) => all.busy(task.threadId)),
        (busy) => !busy,
      )
      yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0' })
      // What the review read, cherry-picked: the commit under the tweak's copy.
      const readAs = git(task.path, 'rev-parse', 'HEAD~1')
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      const [brief] = yield* until(
        sql<{ body: string }>`
          SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The person ships%'`,
        (rows) => rows.length === 1,
      )
      assert.include(brief?.body, `git diff ${readAs.slice(0, 12)}`)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
