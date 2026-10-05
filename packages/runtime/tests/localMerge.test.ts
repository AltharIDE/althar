import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { notices, repository, runtime } from './support'

/*
 * Merging a task without a pull request into its repositories' default
 * branches on this Mac: worked out for all first, then done, never touching
 * the person's uncommitted work, and nothing pushed.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/** Commits a file in a working tree: its head. */
const commit = (cwd: string, file: string, text: string, message = `Write ${file}`) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A project of the given repositories, with a task across them: each repository's root and the task's worktree in it. */
const taskIn = (roots: ReadonlyArray<string>, opened: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    for (const root of roots) {
      git(root, 'config', 'user.name', 'T')
      git(root, 'config', 'user.email', 't@t.test')
    }
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: opened })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Add a retry',
      ...(roots.length > 1 ? { repositories: roots.map((root) => root.split('/').at(-1) ?? '') } : {}),
    })
    const worktrees = yield* sql<{ slug: string; path: string }>`
      SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
      WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
    return { task, worktrees }
  })

const mergeHere = (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) =>
  Effect.flatMap(Changes, (changes) => changes.mergeHere(taskId, heads))

/** Why a merge couldn't happen, as its error says. */
const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

const stateOf = (taskId: string) =>
  Effect.map(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`),
    ([row]) => row?.state,
  )

describe('merging a task here', () => {
  it.live('fast-forwards the default branch where it is checked out and clean, and settles the task', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const head = commit(worktree, 'retry.ts', 'retry\n')
      const merged = yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.deepStrictEqual(
        merged,
        [{ repository: 'althar-repo', branch: 'main', already: false }].map((one) => ({ ...one, repository: merged[0]?.repository ?? '' })),
      )
      assert.strictEqual(git(root, 'rev-parse', 'main'), head)
      // The person's checkout moved with it.
      assert.isTrue(existsSync(join(root, 'retry.ts')))
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        'Merged into main here.',
      )
      // Settled, it isn't merged again.
      const again = yield* Effect.flip(mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }]))
      assert.deepStrictEqual(cantOf(again).slice(0, 2), ['CantMerge', 'settled'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('makes a merge commit where the default branch moved on, and moves the branch alone where nothing has it checked out', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const head = commit(worktree, 'retry.ts', 'retry\n')
      commit(root, 'other.ts', 'other\n')
      // The person works on another branch: main is checked out nowhere.
      git(root, 'checkout', '-q', '-b', 'mine')
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      const parents = git(root, 'rev-list', '--parents', '-n', '1', 'main').split(' ')
      assert.lengthOf(parents, 3)
      assert.strictEqual(parents[2], head)
      assert.include(git(root, 'show', '--format=%B', '-s', 'main'), 'Add a retry')
      assert.include(git(root, 'ls-tree', '--name-only', 'main'), 'retry.ts')
      // The person's own branch and files are as they were.
      assert.strictEqual(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'mine')
      assert.isFalse(existsSync(join(root, 'retry.ts')))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges nothing when it conflicts, or the checkout has changes not committed, or the branch moved since it was seen', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const slug = worktrees[0]?.slug ?? ''
      const head = commit(worktree, 'README.md', '# Retry\n')
      const tip = commit(root, 'README.md', '# Rate limits\n')
      const conflicts = yield* Effect.flip(mergeHere(task.taskId, [{ repository: slug, head }]))
      assert.deepStrictEqual(cantOf(conflicts).slice(1), ['conflicts', 'README.md'])
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)

      const fresh = commit(worktree, 'retry.ts', 'retry\n')
      git(worktree, 'reset', '-q', '--hard', 'HEAD~2')
      const moved = yield* Effect.flip(mergeHere(task.taskId, [{ repository: slug, head: fresh }]))
      assert.strictEqual(cantOf(moved)[1], 'changed')

      const clean = commit(worktree, 'retry.ts', 'retry\n')
      writeFileSync(join(root, 'README.md'), '# Not yet\n')
      const busy = yield* Effect.flip(mergeHere(task.taskId, [{ repository: slug, head: clean }]))
      assert.deepStrictEqual(cantOf(busy).slice(1), ['busy', realpathSync(root)])
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges every repository of a task, or none of them', () =>
    Effect.gen(function* () {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const roots = ['api', 'web'].map((name) => {
        const root = join(folder, name)
        mkdirSync(root)
        git(root, 'init', '-q', '-b', 'main')
        commit(root, 'README.md', `# ${name}\n`)
        return root
      })
      const { task, worktrees } = yield* taskIn(roots, folder)
      const heads = worktrees.map((worktree) => ({ repository: worktree.slug, head: commit(worktree.path, 'README.md', '# Retry\n') }))
      // One conflicts: neither moves.
      const before = roots.map((root) => commit(root, 'README.md', '# Moved on\n'))
      git(roots[0] ?? '', 'reset', '-q', '--hard', 'HEAD~1')
      const refused = yield* Effect.flip(mergeHere(task.taskId, heads))
      assert.deepStrictEqual(cantOf(refused).slice(1), ['conflicts', 'web: README.md'])
      assert.notStrictEqual(git(roots[0] ?? '', 'rev-parse', 'main'), heads[0]?.head)
      assert.strictEqual(git(roots[1] ?? '', 'rev-parse', 'main'), before[1])
      // Without the conflict, both merge.
      git(roots[1] ?? '', 'reset', '-q', '--hard', 'HEAD~1')
      const merged = yield* mergeHere(task.taskId, heads)
      assert.deepStrictEqual(
        merged.map((one) => [one.repository, one.branch, one.already]),
        [
          ['api', 'main', false],
          ['web', 'main', false],
        ],
      )
      assert.deepStrictEqual(
        roots.map((root) => git(root, 'rev-parse', 'main')),
        heads.map((one) => one.head),
      )
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        'Merged here: api into main, web into main.',
      )
    }).pipe(Effect.provide(runtime())),
  )
})
