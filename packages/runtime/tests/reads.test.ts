import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { commitsOf, indexStamp } from '../src/git'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { addItem, updateItem } from '../src/threads'
import { repository, runtime, until } from './support'

/*
 * What screens read from git of a task's worktrees: kept while each looks
 * the same, and read again once a commit, staging, a tool call of the
 * lead's or its default branch moving changes it; let go of once its task
 * leaves the screens.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/** Commits a file in a working tree. */
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
}

/**
 * Puts a worktree's files a minute in the past and has git note that in its
 * index, so git has nothing of its own left to write there: an edit nobody
 * staged is then one only reading git afresh would see.
 */
const quiet = (worktree: string) => {
  const past = new Date(Date.now() - 60_000)
  for (const name of readdirSync(worktree)) if (name !== '.git') utimesSync(join(worktree, name), past, past)
  git(worktree, 'update-index', '-q', '--refresh')
}

/** A project with a task its fake lead did, with a commit, and is ready: its ids, its worktree and its repository's root. */
const ready = Effect.gen(function* () {
  const projects = yield* Projects
  const plans = yield* Plans
  const instance = yield* Instance
  const queries = yield* Queries
  const sql = yield* SqlClient.SqlClient
  const root = repository()
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Add a retry',
    description: '[lead:finish] [lead:edit]',
    draft: true,
  })
  const planId = yield* plans.propose({
    projectId: project.projectId as ProjectId,
    taskId: task.taskId,
    steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
    reason: null,
    actorId: instance.personId,
  })
  yield* plans.start(planId, instance.personId)
  yield* until(
    Effect.map(queries.board(project.projectId), (board) => board.tasks),
    (tasks) => tasks[0]?.phase === 'ready',
    Duration.seconds(20),
  )
  const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
  return { projectId: project.projectId, taskId: task.taskId, threadId: task.threadId, worktree: workspace?.path ?? '', root }
})

/** The files a task changed, as its thread shows them. */
const filesIn = (threadId: string) =>
  Effect.flatMap(Queries, (queries) => Effect.map(queries.thread(threadId), (thread) => thread.task.files.map((file) => file.path)))

describe('what screens read from git', () => {
  it.live('reads a worktree again once a commit or staging changes it', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { projectId, threadId, worktree } = yield* ready
      const card = Effect.map(queries.board(projectId), (board) => board.tasks[0])
      assert.deepStrictEqual((yield* card)?.changed, { files: 1, add: 1, del: 0 })

      // A commit shows at once, on the board and in the thread.
      commit(worktree, 'retry.ts', 'retry\n')
      assert.deepStrictEqual((yield* card)?.changed, { files: 2, add: 2, del: 0 })
      const committed = yield* queries.thread(threadId)
      assert.deepStrictEqual([committed.task.files.map((file) => file.path), committed.task.commits], [['change.txt', 'retry.ts'], 2])

      // An edit nobody staged waits for the index: what was read stands until something is staged.
      quiet(worktree)
      yield* filesIn(threadId)
      writeFileSync(join(worktree, 'README.md'), '# Retry\n')
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt', 'retry.ts'])
      git(worktree, 'add', 'README.md')
      const staged = yield* queries.thread(threadId)
      assert.deepInclude(
        staged.task.files.find((file) => file.path === 'README.md'),
        { status: 'modified', add: 1, del: 1, uncommitted: true },
      )
      assert.deepStrictEqual([staged.task.commits, (yield* card)?.changed], [2, { files: 3, add: 3, del: 1 }])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("reads a worktree again after each of the lead's tool calls, which may have changed it", () =>
    Effect.gen(function* () {
      const { projectId, threadId, worktree } = yield* ready
      quiet(worktree)
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])
      writeFileSync(join(worktree, 'notes.md'), 'notes\n')
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])

      // The lead calls a tool: what it did shows.
      const place = { projectId: projectId as ProjectId, threadId }
      const call = { title: 'Write notes.md', kind: 'edit' }
      const id = yield* addItem(place, 'tool_call', { ...call, status: 'in_progress' }, { toolCallId: 'write-notes' })
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt', 'notes.md'])
      // And again as the call goes on.
      writeFileSync(join(worktree, 'more.md'), 'more\n')
      yield* updateItem(place.projectId, id, { ...call, status: 'completed' })
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt', 'more.md', 'notes.md'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says a task is merged here once its default branch has its head, however it got there', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { projectId, threadId, worktree, root } = yield* ready
      const card = Effect.map(queries.board(projectId), (board) => board.tasks[0])
      const head = git(worktree, 'rev-parse', 'HEAD')
      assert.deepStrictEqual(
        (yield* card)?.here.map((one) => [one.branch, one.head]),
        [['main', head]],
      )
      assert.strictEqual((yield* queries.thread(threadId)).task.commits, 1)

      // Merged by hand, outside Althar: the board and the thread see it, and nothing is left that is the task's own.
      git(root, 'merge', '-q', '--ff-only', head)
      // Where git can't tell, as with the repository's folder gone, it isn't merged, and that isn't kept for when it can.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE repository_locations SET path = ${join(root, 'gone')}`
      assert.deepStrictEqual(
        (yield* card)?.here.map((one) => one.head),
        [head],
      )
      yield* sql`UPDATE repository_locations SET path = ${root}`
      const merged = yield* card
      assert.deepStrictEqual([merged?.here, merged?.changed], [[], { files: 0, add: 0, del: 0 }])
      const thread = yield* queries.thread(threadId)
      assert.deepStrictEqual([thread.task.here, thread.task.files, thread.task.commits], [[], [], 0])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('lets go of what it read of a task once the board no longer shows it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const instance = yield* Instance
      const { projectId, taskId, threadId, worktree } = yield* ready
      quiet(worktree)
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])
      // Settled, the task is still on the board, so what was read of it is kept: an edit nobody staged doesn't show.
      writeFileSync(join(worktree, 'notes.md'), 'notes\n')
      yield* sql`UPDATE tasks SET state = 'done', settled_at = ${new Date(Date.now() - 60_000).toISOString()} WHERE id = ${taskId}`
      yield* queries.board(projectId)
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])

      // Thirty tasks settled since push it off the board: what was kept goes, and git is read afresh.
      const now = new Date().toISOString()
      for (let n = 0; n < 30; n += 1)
        yield* sql`
          INSERT INTO tasks (id, project_id, title, slug, state, created_by_actor_id, created_at, settled_at)
          VALUES (${yield* newId(Ids.task)}, ${projectId}, 'Done since', ${`done-since-${n}`}, 'done', ${instance.personId}, ${now}, ${now})`
      assert.notInclude(
        (yield* queries.board(projectId)).tasks.map((task) => task.taskId),
        taskId,
      )
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt', 'notes.md'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('lets go of what it read of a task once it is settled and the home is read', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const { taskId, threadId, worktree } = yield* ready
      quiet(worktree)
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])
      writeFileSync(join(worktree, 'notes.md'), 'notes\n')
      assert.isTrue((yield* queries.home()).tasks.some((task) => task.taskId === taskId))
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt'])

      yield* sql`UPDATE tasks SET state = 'done', settled_at = ${new Date().toISOString()} WHERE id = ${taskId}`
      assert.isFalse((yield* queries.home()).tasks.some((task) => task.taskId === taskId))
      assert.deepStrictEqual(yield* filesIn(threadId), ['change.txt', 'notes.md'])
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('the git screens read with', () => {
  it.effect("names each revision's commit in one go, and none for what git doesn't know or isn't one name", () =>
    Effect.gen(function* () {
      const root = repository()
      const head = git(root, 'rev-parse', 'HEAD')
      assert.deepStrictEqual(
        yield* commitsOf(root, ['HEAD', 'main', 'origin/main', 'deadbeef'.repeat(5), '--output=taken', 'HEAD:README.md', '']),
        [head, head, null, null, null, null, null],
      )
      assert.deepStrictEqual(yield* commitsOf(root, []), [])
      assert.deepStrictEqual(yield* commitsOf(join(root, 'missing'), ['HEAD']), [null])
    }),
  )

  it.effect("stamps a worktree's index, linked or not, anew whenever git writes it", () =>
    Effect.gen(function* () {
      const root = repository()
      const linked = join(mkdtempSync(join(tmpdir(), 'althar-linked-')), 'task')
      git(root, 'worktree', 'add', '-q', '-b', 'task', linked)
      const before = yield* indexStamp(linked)
      assert.notStrictEqual(before, '')
      writeFileSync(join(linked, 'retry.ts'), 'retry\n')
      git(linked, 'add', 'retry.ts')
      assert.notStrictEqual(yield* indexStamp(linked), before)
      assert.notStrictEqual(yield* indexStamp(root), '')
      assert.notStrictEqual(yield* indexStamp(root), yield* indexStamp(linked))
      assert.strictEqual(yield* indexStamp(join(root, 'missing')), '')
      // A `.git` file that names no folder is no index.
      const odd = mkdtempSync(join(tmpdir(), 'althar-odd-'))
      writeFileSync(join(odd, '.git'), 'nothing here\n')
      assert.strictEqual(yield* indexStamp(odd), '')
    }),
  )
})
