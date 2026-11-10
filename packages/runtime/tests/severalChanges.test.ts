import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
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
 * A task holds as many changes as it needs (a task is a conversation plus
 * parts): another change starts at once, on its own branch, in a worktree of
 * its own beside the task's first; it ships, and opens its pull request, on
 * its own; and a merge ends only its own change: the task settles once all
 * of them are done.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A planned task whose lead did its part and whose draft pull request opened, with no review. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
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

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; name: string | null; branch: string; path: string; toward: string | null; state: string }>`
      SELECT id, name, branch, path, toward, state FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

describe('a task with several changes', () => {
  it.live('starts another change on its own branch and worktree, ships it as its own pull request, and settles once both merge', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const said = yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      assert.match(said, /^Started a change of [^,]+, “Lane heights”: its worktree is /)

      // Its own row, beside the first, on a branch of its own named for it, working toward what the task does.
      const [first, second] = yield* workspacesOf(task.taskId)
      assert.strictEqual(second?.name, 'Lane heights')
      assert.strictEqual(second?.branch, 'althar/lane-heights')
      assert.strictEqual(second?.state, 'ready')
      assert.isTrue(existsSync(second?.path ?? ''))
      assert.notStrictEqual(second?.path, first?.path)
      assert.strictEqual(git(second?.path ?? '', 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/lane-heights')
      // The thread marks it as a step in the work.
      const step = (yield* items(task.threadId)).findLast((item) => item.kind === 'notice')
      assert.deepStrictEqual((step?.content as { step?: unknown } | undefined)?.step, {
        kind: 'new_change',
        name: 'Lane heights',
        branch: 'althar/lane-heights',
        toward: null,
      })
      // Its card counts them; a second name refused, as is a branch a change has.
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.changeCount === 2)
      assert.strictEqual(card?.changeCount, 2)
      assert.include(yield* callTool(task.lead, 'start_change', { name: 'lane heights' }), 'already')

      // Its work is committed in its own folder, and Ship opens its pull request, leaving the first's as it was.
      writeFileSync(join(second?.path ?? '', 'lanes.txt'), 'taller\n')
      git(second?.path ?? '', 'add', 'lanes.txt')
      git(second?.path ?? '', 'commit', '-q', '-m', 'Taller lanes')
      const firstHead = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.target], ['althar/lane-heights', 'main'])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), firstHead)
      // Each pull request says which change it is.
      const snapshot = yield* (yield* Queries).thread(task.threadId)
      const named = snapshot.task.changes.map((change) => change.change?.name ?? null)
      assert.deepStrictEqual(named, [null, 'Lane heights'])

      // The first merges: the task carries on, its other change open.
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      const sql = yield* SqlClient.SqlClient
      const [open] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`
      assert.strictEqual(open?.state, 'open')
      // The second merges too: now it settles.
      squashMerge(bare, 'althar/lane-heights')
      github.mergeByHand(2)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, (rows) => rows[0]?.state === 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('stacks a change on another, its pull request going into that one’s branch', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      const said = yield* callTool(task.lead, 'start_change', { name: 'Lane colours', on: 'Lane heights' })
      assert.include(said, 'stacked on Lane heights')
      const [, below, above] = yield* workspacesOf(task.taskId)
      assert.strictEqual(above?.toward, below?.branch)
      // It starts from the one below's branch.
      assert.strictEqual(git(above?.path ?? '', 'rev-parse', 'HEAD'), git(below?.path ?? '', 'rev-parse', 'HEAD'))
      assert.include(yield* callTool(task.lead, 'start_change', { name: 'Nowhere', on: 'No such change' }), 'no change “No such change”')
      // Started by the coordinator, its lead is told where it is.
      const sql = yield* SqlClient.SqlClient
      const [coordinatorSession] = yield* sql<{ id: string; threadId: string }>`
        SELECT s.id, s.thread_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.kind = 'coordinator' LIMIT 1`
      if (coordinatorSession !== undefined) {
        yield* callTool(
          {
            role: 'coordinator',
            projectId: task.projectId,
            threadId: coordinatorSession.threadId,
            sessionId: coordinatorSession.id,
            taskId: null,
          },
          'start_change',
          { task: (yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`)[0]?.slug, name: 'Docs' },
        )
        const told = yield* until(
          sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'A new change of this task%'`,
          (rows) => rows.length === 1,
        )
        assert.include(told[0]?.body ?? '', 'Docs')
      }
      assert.isTrue(Option.isSome(Option.some(github)))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('follows a branch its lead made with git as a change of the task’s, and takes the pull request opened from it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const sql = yield* SqlClient.SqlClient
      // The lead makes a branch with git in its folder, and commits there.
      git(task.path, 'switch', '-q', '-c', 'althar/docs-only')
      writeFileSync(join(task.path, 'docs.txt'), 'docs\n')
      git(task.path, 'add', 'docs.txt')
      git(task.path, 'commit', '-q', '-m', 'Docs')
      git(task.path, 'push', '-q', bare, 'althar/docs-only')
      // Someone opens its pull request on the website, outside Althar.
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Docs', author: 'fake', source: 'althar/docs-only', target: 'main' })
      // As the lead's next turn ends, the folder's branch is a change of the task's, and the change it left keeps its own.
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId }),
        threadId: task.threadId,
        body: 'How is it going?',
      })
      const rows = yield* until(workspacesOf(task.taskId), (all) => all.length === 2 && all[1]?.state === 'ready')
      assert.deepStrictEqual(
        rows.map((row) => [row.branch, row.state, row.path === task.path]),
        [
          ['althar/add-a-retry', 'away', true],
          ['althar/docs-only', 'ready', true],
        ],
      )
      const line = yield* until(
        Effect.map(items(task.threadId), (all) =>
          all.filter((item) => item.kind === 'notice' && (item.content as { step?: unknown }).step !== undefined),
        ),
        (found) => found.length === 1,
      )
      assert.strictEqual((line[0]?.content as { step?: { name?: string } } | undefined)?.step?.name, 'althar/docs-only')
      // Its pull request, found by its own branch and target, is the new change's; the first keeps following its own.
      const [linked] = yield* until(
        sql<{ workspaceId: string | null; url: string }>`
          SELECT c.workspace_id, c.pull_request_url AS url FROM repository_changes c WHERE c.branch = 'althar/docs-only'`,
        (found) => found.length === 1,
      )
      assert.strictEqual(linked?.workspaceId, rows[1]?.id)
      const following = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM external_links WHERE task_id = ${task.taskId} AND kind = 'change' AND listening = 1`
      assert.strictEqual(following[0]?.n, 2)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
