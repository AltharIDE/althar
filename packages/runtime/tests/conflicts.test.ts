import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, notices, repository, runtime, turns, until } from './support'

/*
 * A lead resolving a conflict with its default branch on its own, where the
 * project's rules say to (docs/architecture/06, "Resolving a conflict"):
 * found merging here or said by the pull request's host, the lead is asked
 * as the person would ask it, unasked; what it resolves on a pull request,
 * Althar pushes, and only that. One it can't resolve is asked once more,
 * then is the person's. Without the rule, a conflict waits for the person,
 * as it always has.
 */

const runtimeWith = (services: { readonly github?: FakeService } = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services), listenEvery: Duration.millis(100) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: 'pipe' })
    .toString()
    .trim()

/** Whether git's merge of two commits in a repository conflicts, as a host works it out. */
const conflictsIn = (cwd: string, into: string, from: string) => {
  try {
    git(cwd, 'merge-tree', '--write-tree', into, from)
    return false
  } catch {
    return true
  }
}

/** Commits a change to the file the lead's `[lead:edit]` writes, on the repository's `main`: the default branch moves on. */
const moveMainOn = (root: string) => {
  writeFileSync(join(root, 'change.txt'), 'rate limits\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'Limit rates')
}

/** Opens the repository as a project, with the rule on or not, and asks its coordinator for a change. */
const ask = (working: string, body: string, resolveConflicts: boolean) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (resolveConflicts) yield* (yield* Policies).set(project.projectId, { resolveConflicts: true }, (yield* Instance).personId)
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    return project.projectId
  })

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** The task's worktree, by its repository's slug. */
const worktreeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [worktree] = yield* sql<{ slug: string; path: string }>`
      SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${taskId}`
    return { slug: worktree?.slug ?? '', path: worktree?.path ?? '' }
  })

/** Merges the task's branch here at its head now, as the person's press does. */
const mergeHere = (taskId: string) =>
  Effect.gen(function* () {
    const { slug, path } = yield* worktreeOf(taskId)
    return yield* (yield* Changes).mergeHere(taskId, [{ repository: slug, head: git(path, 'rev-parse', 'HEAD') }])
  })

const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

const rounds = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ state: string; attempt: number; url: string | null; pushedHead: string | null }>`
      SELECT state, attempt, pull_request_url AS url, pushed_head FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at`,
  )

/** What the lead was asked, in the task's thread. */
const asked = (threadId: string) =>
  Effect.map(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence`,
    ),
    (rows) => rows.map((row) => row.body).filter((body) => body.includes('Bring the branch up to date')),
  )

/** What the lead's brief says Althar pushes for it, where the project has it resolve conflicts. */
const PUSHED_FOR_IT = 'Althar pushes it to the pull request itself. Nothing else you commit is pushed for you, and you still never push.'

/** The lead's brief: its first turn. */
const briefOf = (threadId: string) => Effect.map(turns(threadId), (all) => all[0]?.prompt ?? '')

const titled = (threadId: string, start: string) =>
  until(notices(threadId), (all) => all.some((notice) => notice.title?.startsWith(start) === true), Duration.seconds(20))

describe('a conflict merging here', () => {
  it.live('waits for the person to ask the lead, as it always has, where the project doesn’t say', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        false,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      moveMainOn(working)
      const refused = yield* Effect.flip(mergeHere(task?.taskId ?? ''))
      assert.deepStrictEqual(cantOf(refused), ['CantMerge', 'conflicts', 'change.txt'])
      // Nothing is asked of the lead: the window offers the person to.
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* rounds(task?.taskId ?? ''), [])
      assert.deepStrictEqual(yield* asked(task?.threadId ?? ''), [])
      assert.notInclude(yield* briefOf(task?.threadId ?? ''), PUSHED_FOR_IT)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('is resolved by the lead unasked, with no review round, for the person to merge again', () => {
    const working = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass] [lead:resolve]', true)
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      const reviews = sql<{ n: number }>`
        SELECT count(*) AS n FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review'`
      const [reviewed] = yield* reviews
      moveMainOn(working)
      const refused = yield* Effect.flip(mergeHere(taskId))
      assert.deepStrictEqual(cantOf(refused), ['CantMerge', 'resolving', 'change.txt'])
      // Asked as the person's press asks it.
      const [note] = yield* asked(threadId)
      assert.include(note, 'Bring the branch up to date: merge main into it')
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['resolved', 1]],
      )
      const { path } = yield* worktreeOf(taskId)
      assert.strictEqual(git(path, 'merge-base', '--is-ancestor', 'main', 'HEAD'), '')
      // No review round for it, and it waits on the person again.
      assert.strictEqual((yield* reviews)[0]?.n, reviewed?.n)
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      // Asked while it resolves, or merged after, nothing more is asked of it.
      yield* mergeHere(taskId)
      // Both sides hold, as the lead settled them.
      assert.strictEqual(git(working, 'show', 'main:change.txt'), 'change\nrate limits')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('is asked once more with why, then given back to the person, who sees it as before', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve-fails]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      yield* titled(threadId, 'The lead couldn’t resolve the conflict with main, in change.txt')
      // Twice: the second time with why the first didn't.
      const notes = yield* asked(threadId)
      assert.strictEqual(notes.length, 2)
      assert.match(notes[1] ?? '', /^The conflict isn't resolved yet: main isn't merged into the branch\. Try once more\./)
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['failed', 2]],
      )
      // Needs you, where the person's own press would leave it: merging again offers to ask the lead, and asks nothing itself.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'conflicts')
      assert.strictEqual((yield* asked(threadId)).length, 2)
      assert.strictEqual((yield* rounds(taskId)).length, 1)
    }).pipe(Effect.provide(runtimeWith()))
  })
})

describe('a conflict its pull request’s host reports', () => {
  /** A GitHub whose pull request conflicts when the bare repository's `main` and the task's branch do. */
  const hostOf = (bare: string) => {
    const tip = () => {
      try {
        return git(bare, 'rev-parse', 'althar/add-a-retry')
      } catch {
        return null
      }
    }
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tip,
      conflictsOf: () => (tip() === null ? undefined : conflictsIn(bare, 'main', 'althar/add-a-retry')),
    })
    github.addRepository(['meridian', 'api'])
    return github
  }

  const connect = Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
  })

  /** The default branch moves on where the host has it, conflicting with what the task changed. */
  const moveHostMainOn = (working: string, bare: string) => {
    moveMainOn(working)
    git(working, 'push', '-q', bare, 'main')
  }

  it.live('is resolved by the lead, and Althar pushes the merge to the pull request', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare)
    return Effect.gen(function* () {
      yield* connect
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change !== null, Duration.seconds(20))
      const threadId = task?.threadId ?? ''
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to')
      // Its brief says what Althar pushes for it, and that it never pushes itself.
      assert.include(yield* briefOf(threadId), PUSHED_FOR_IT)
      const [note] = yield* asked(threadId)
      assert.include(note, 'merge origin/main into it, which Althar has fetched')
      assert.include(note, "don't push it yourself")
      // The pull request has the merge, and conflicts no more.
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'), '')
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
      const [round] = yield* rounds(task?.taskId ?? '')
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', git(bare, 'rev-parse', 'althar/add-a-retry')])
      // Nothing left to push, and it waits on the person to merge it.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.unpushed === 0, Duration.seconds(20))
      // Asked once, though the host said so on every look until the merge was pushed.
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push the merge where the branch has other commits the pull request doesn’t', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare)
    return Effect.gen(function* () {
      yield* connect
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change !== null, Duration.seconds(20))
      const threadId = task?.threadId ?? ''
      // The lead fixed a check and committed it, for the person to push.
      github.setChecks(1, [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts' }])
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1, Duration.seconds(20))
      const before = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      // Neither the merge nor the fix went up: both wait for the person's push.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      const [round] = yield* rounds(task?.taskId ?? '')
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', null])
      const [waiting] = yield* until(cards(projectId), (all) => (all[0]?.change?.unpushed ?? 0) > 1, Duration.seconds(20))
      const { path } = yield* worktreeOf(task?.taskId ?? '')
      assert.strictEqual(waiting?.change?.localHead, git(path, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
