import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { NotFound } from '../src/errors'
import { applyMerges, planMerge } from '../src/localMerge'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
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

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

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

  it.live('says what the remote doesn’t have once merged, pushes it with the person’s own git, and says when the remote has moved on', () =>
    Effect.gen(function* () {
      const root = repository()
      // Its default branch follows a remote's.
      const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'add', 'origin', remote)
      git(root, 'push', '-q', '-u', 'origin', 'main')
      const { task, worktrees } = yield* taskIn([root], root)
      const slug = worktrees[0]?.slug ?? ''
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      const queries = yield* Queries
      const mergedOf = Effect.map(queries.thread(task.threadId, {}), (snapshot) => snapshot.task.merged)
      assert.deepStrictEqual(yield* mergedOf, [])
      yield* mergeHere(task.taskId, [{ repository: slug, head }])
      assert.deepStrictEqual(yield* mergedOf, [
        { repository: slug, name: root.split('/').at(-1) ?? '', branch: 'main', remote: 'origin/main', ahead: 1 },
      ])
      const changes = yield* Changes
      assert.deepStrictEqual(yield* changes.pushHere(task.taskId), [{ branch: 'main', remote: 'origin/main' }])
      assert.strictEqual(git(remote, 'rev-parse', 'main'), head)
      assert.deepStrictEqual(yield* mergedOf, [
        { repository: slug, name: root.split('/').at(-1) ?? '', branch: 'main', remote: 'origin/main', ahead: 0 },
      ])
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        'Pushed main to origin.',
      )
      // The remote moved on meanwhile: it refuses, and says how to put it right.
      const elsewhere = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
      git(elsewhere, 'clone', '-q', remote, '.')
      commit(elsewhere, 'theirs.ts', 'theirs\n')
      git(elsewhere, 'push', '-q', 'origin', 'main')
      commit(root, 'mine.ts', 'mine\n')
      const refused = yield* Effect.flip(changes.pushHere(task.taskId))
      assert.deepStrictEqual([(refused as { _tag?: string })._tag, (refused as { why?: string }).why], ['PushRefused', 'behind'])
      // A remote that refuses on its own terms, as a protected branch does, says why in its words.
      git(root, 'pull', '-q', '--no-rebase', 'origin', 'main')
      writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      const declined = yield* Effect.flip(changes.pushHere(task.taskId))
      assert.deepStrictEqual(
        [(declined as { why?: string }).why, (declined as { said?: string }).said],
        ['refused', 'pre-receive hook declined'],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('pushes the task’s branch with the person’s own git, up to what they saw, and says where a pull request can be', () =>
    Effect.gen(function* () {
      const root = repository()
      // Its remote reads as GitHub, and takes pushes in a folder here.
      const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'add', 'origin', 'https://github.com/meridian/api.git')
      git(root, 'remote', 'set-url', '--push', 'origin', remote)
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const slug = worktrees[0]?.slug ?? ''
      const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
      const head = commit(worktree, 'retry.ts', 'retry\n')
      const queries = yield* Queries
      const remoteOf = Effect.map(queries.thread(task.threadId, {}), (snapshot) => snapshot.task.here[0]?.remote)
      assert.deepStrictEqual(yield* remoteOf, {
        name: 'origin',
        branch,
        pushed: false,
        ahead: 1,
        newPullRequest: `https://github.com/meridian/api/compare/main...${branch}?expand=1`,
      })
      const changes = yield* Changes
      assert.deepStrictEqual(yield* changes.pushBranch(task.taskId, [{ repository: slug, head }]), [{ branch, remote: 'origin' }])
      assert.strictEqual(git(remote, 'rev-parse', branch), head)
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        `Pushed ${branch} to origin.`,
      )
      assert.deepInclude(yield* remoteOf, { pushed: true, ahead: 0 })
      // More from the lead: the remote is behind it, and a commit the person didn't see isn't pushed.
      const later = commit(worktree, 'more.ts', 'more\n')
      assert.deepInclude(yield* remoteOf, { pushed: true, ahead: 1 })
      assert.deepStrictEqual(cantOf(yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: slug, head: 'f'.repeat(40) }]))), [
        'CantMerge',
        'changed',
        '',
      ])
      yield* changes.pushBranch(task.taskId, [{ repository: slug, head: later }])
      assert.strictEqual(git(remote, 'rev-parse', branch), later)
      // The task stays as it was: pushing isn't merging.
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('has nowhere to push a branch in a repository without a remote', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      const queries = yield* Queries
      assert.isNull((yield* queries.thread(task.threadId, {})).task.here[0]?.remote)
      const changes = yield* Changes
      const none = yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }]))
      assert.deepStrictEqual([(none as { _tag?: string })._tag, (none as { kind?: string }).kind], ['NotFound', 'remote'])
      assert.strictEqual(((yield* Effect.flip(changes.pushBranch('task_unknown', []))) as { _tag?: string })._tag, 'NotFound')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('pushes nothing where the default branch follows no remote, and says what git said where the remote is gone', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const changes = yield* Changes
      assert.instanceOf(yield* Effect.flip(changes.pushHere('task_unknown')), NotFound)
      // Nothing merged yet: nothing to push.
      assert.deepStrictEqual(yield* changes.pushHere(task.taskId), [])
      yield* mergeHere(task.taskId, [
        { repository: worktrees[0]?.slug ?? '', head: commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n') },
      ])
      // Merged, but following nothing: nowhere to push it, and nothing said of a push.
      assert.deepStrictEqual(yield* changes.pushHere(task.taskId), [])
      assert.notInclude((yield* notices(task.threadId)).map((notice) => notice.title).join(' '), 'Pushed')
      // Following a remote that isn't there any more: git's own failure, not a guess at why.
      git(root, 'remote', 'add', 'origin', join(tmpdir(), `althar-gone-${Date.now()}`))
      git(root, 'config', 'branch.main.remote', 'origin')
      git(root, 'config', 'branch.main.merge', 'refs/heads/main')
      assert.strictEqual(((yield* Effect.flip(changes.pushHere(task.taskId))) as { _tag?: string })._tag, 'GitFailed')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('pushes only where the task’s own work merged, never a repository it left alone', () =>
    Effect.gen(function* () {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const roots = ['api', 'web'].map((name) => {
        const root = join(folder, name)
        mkdirSync(root)
        git(root, 'init', '-q', '-b', 'main')
        commit(root, 'README.md', `# ${name}\n`)
        return root
      })
      const remotes = roots.map((root) => {
        const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
        git(bare, 'init', '-q', '--bare', '-b', 'main')
        git(root, 'remote', 'add', 'origin', bare)
        git(root, 'push', '-q', '-u', 'origin', 'main')
        return bare
      })
      const { task, worktrees } = yield* taskIn(roots, folder)
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      yield* mergeHere(task.taskId, [
        { repository: worktrees[0]?.slug ?? '', head },
        { repository: worktrees[1]?.slug ?? '', head: git(worktrees[1]?.path ?? '', 'rev-parse', 'HEAD') },
      ])
      // The person's own commit on the other repository's main, not pushed yet: not the task's to push.
      const theirs = commit(roots[1] ?? '', 'mine.ts', 'mine\n')
      const changes = yield* Changes
      const pushed = yield* changes.pushHere(task.taskId)
      assert.deepStrictEqual(
        pushed.map((one) => one.remote),
        ['origin/main'],
      )
      assert.strictEqual(git(remotes[0] ?? '', 'rev-parse', 'main'), head)
      assert.notStrictEqual(git(remotes[1] ?? '', 'rev-parse', 'main'), theirs)
    }).pipe(Effect.provide(withQueries())),
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

  it.live('merges nothing where a checkout has a file git doesn’t track where the merge puts one, and says which', () =>
    Effect.gen(function* () {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const roots = ['api', 'web'].map((name) => {
        const root = join(folder, name)
        mkdirSync(root)
        git(root, 'init', '-q', '-b', 'main')
        commit(root, 'README.md', `# ${name}\n`)
        writeFileSync(join(root, '.gitignore'), 'dist/\n')
        git(root, 'add', '.')
        git(root, 'commit', '-q', '-m', 'Ignore dist')
        return root
      })
      const { task, worktrees } = yield* taskIn(roots, folder)
      const heads = worktrees.map((worktree) => ({ repository: worktree.slug, head: commit(worktree.path, 'new.ts', 'new\n') }))
      const before = roots.map((root) => git(root, 'rev-parse', 'main'))
      // The person started the same file in web: git won't overwrite it, so neither moves.
      writeFileSync(join(roots[1] ?? '', 'new.ts'), 'mine\n')
      // One git ignores isn't in the way: git replaces those.
      mkdirSync(join(roots[0] ?? '', 'dist'))
      writeFileSync(join(roots[0] ?? '', 'dist', 'new.ts'), 'built\n')
      const refused = yield* Effect.flip(mergeHere(task.taskId, heads))
      assert.deepStrictEqual(cantOf(refused).slice(1), ['untracked', `new.ts in ${roots[1] ?? ''}`])
      assert.deepStrictEqual(
        roots.map((root) => git(root, 'rev-parse', 'main')),
        before,
      )
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('moves refs first and checkouts last, and puts back what moved when one refuses', () =>
    Effect.gen(function* () {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      const [bare, open, other] = ['api', 'web', 'docs'].map((name) => {
        const root = join(folder, name)
        mkdirSync(root)
        git(root, 'init', '-q', '-b', 'main')
        commit(root, 'README.md', `# ${name}\n`)
        return root
      })
      // api's main is checked out nowhere, so it moves as a ref; web's and docs' are checked out, so they fast-forward there.
      git(bare ?? '', 'checkout', '-q', '-b', 'mine')
      const planOf = (root: string) =>
        Effect.gen(function* () {
          git(root, 'checkout', '-q', '-b', 'task', 'main')
          const head = commit(root, 'retry.ts', 'retry\n')
          git(root, 'checkout', '-q', root === bare ? 'mine' : 'main')
          const plan = yield* planMerge(root, 'main', head, 'Merge task')
          if (plan.kind !== 'move') return assert.fail(`planned ${plan.kind}`)
          return { root, branch: 'main', plan, before: git(root, 'rev-parse', 'main') }
        })
      const moves = [yield* planOf(bare ?? ''), yield* planOf(open ?? ''), yield* planOf(other ?? '')]
      assert.deepStrictEqual(
        moves.map((move) => move.plan.checkout),
        [null, open, other],
      )
      // Something written in docs since the plan: its fast-forward refuses, last, and api and web go back.
      writeFileSync(join(other ?? '', 'retry.ts'), 'mine\n')
      const refused = yield* applyMerges(moves.toReversed())
      assert.strictEqual(refused?.root, other)
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.before),
      )
      assert.strictEqual(git(open ?? '', 'status', '--porcelain'), '')
      // A ref that moved since the plan refuses as well, and nothing else moves.
      git(other ?? '', 'clean', '-q', '-f')
      git(bare ?? '', 'update-ref', 'refs/heads/main', git(bare ?? '', 'rev-parse', 'task'))
      assert.strictEqual((yield* applyMerges(moves))?.root, bare)
      assert.deepStrictEqual(
        moves.slice(1).map((move) => git(move.root, 'rev-parse', 'main')),
        moves.slice(1).map((move) => move.before),
      )
      // Nothing in the way, every one moves.
      git(bare ?? '', 'update-ref', 'refs/heads/main', moves[0]?.before ?? '')
      assert.isNull(yield* applyMerges(moves))
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.plan.to),
      )
    }).pipe(Effect.provide(runtime())),
  )
})
