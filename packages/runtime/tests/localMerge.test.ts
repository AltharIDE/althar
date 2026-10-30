import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { coAuthorLine } from '../src/credit'
import { NotFound } from '../src/errors'
import { applyMerge, applyMerges, checkedOut, conflictsOf, planMerge, undoMerge } from '../src/localMerge'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { notices, repository, runtime } from './support'

/** Windows, where what some tests stand on isn't (each says what). */
const windows = process.platform === 'win32'

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
      ...(roots.length > 1 ? { repositories: roots.map((root) => basename(root)) } : {}),
    })
    const worktrees = yield* sql<{ slug: string; path: string }>`
      SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
      WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`
    return { task, worktrees }
  })

/** Makes a repository in place at `library` a submodule of `root`, its git directory under the project's: its path. */
const withLibrary = (root: string) => {
  const library = join(root, 'library')
  mkdirSync(library)
  git(library, 'init', '-q', '-b', 'main')
  commit(library, 'README.md', '# Library\n')
  git(root, 'submodule', 'add', '-q', './library', 'library')
  git(root, 'submodule', 'absorbgitdirs')
  git(root, 'commit', '-q', '-m', 'Add library')
  return library
}

const mergeHere = (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) =>
  Effect.flatMap(Changes, (changes) => changes.mergeHere(taskId, heads))

/** Why a merge couldn't happen, as its error says. */
const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

/** A merge refused for what's in the way in a checkout: why, where, into which branch, and the files. */
const inTheWayOf = (error: unknown) => {
  const said = error as { readonly why?: string; readonly detail?: string; readonly into?: string; readonly files?: ReadonlyArray<string> }
  return [said.why, said.detail, said.into, said.files]
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
      // The task's commit, credited to Althar as co-author, and the task's branch with it.
      assert.strictEqual(git(root, 'rev-parse', 'main'), git(worktree, 'rev-parse', 'HEAD'))
      assert.strictEqual(git(root, 'show', '-s', '--format=%B', 'main'), `Write retry.ts\n\n${coAuthorLine}`)
      assert.notStrictEqual(git(root, 'rev-parse', 'main'), head)
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
      assert.deepStrictEqual(yield* mergedOf, [{ repository: slug, name: basename(root), branch: 'main', remote: 'origin/main', ahead: 1 }])
      const changes = yield* Changes
      assert.deepStrictEqual(yield* changes.pushHere(task.taskId), [{ branch: 'main', remote: 'origin/main' }])
      // The task's commit as it merged: credited, Althar its co-author.
      assert.strictEqual(git(remote, 'rev-parse', 'main'), git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'))
      assert.notStrictEqual(git(remote, 'rev-parse', 'main'), head)
      assert.include(git(remote, 'log', '-1', '--format=%B', 'main'), coAuthorLine)
      assert.deepStrictEqual(yield* mergedOf, [{ repository: slug, name: basename(root), branch: 'main', remote: 'origin/main', ahead: 0 }])
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
      // It fetches from the team's repository on GitHub and pushes to the person's fork there.
      git(root, 'remote', 'add', 'origin', 'https://github.com/meridian/api.git')
      git(root, 'remote', 'set-url', '--push', 'origin', 'git@github.com:alice/api.git')
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const slug = worktrees[0]?.slug ?? ''
      const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
      const head = commit(worktree, 'retry.ts', 'retry\n')
      const queries = yield* Queries
      const remoteOf = Effect.map(queries.thread(task.threadId, {}), (snapshot) => snapshot.task.here[0]?.remote)
      // The pull request opens where the branch goes; what of it origin has isn't known here before it is asked or pushed to.
      assert.deepStrictEqual(yield* remoteOf, {
        name: 'origin',
        branch,
        pushed: false,
        ahead: null,
        newPullRequest: `https://github.com/alice/api/compare/main...${branch}?expand=1`,
      })
      // Now it pushes to a folder here, and fetches only main, so git wouldn't note the branch there itself.
      const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'set-url', '--push', 'origin', remote)
      git(root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
      // More from the lead after the person looked, crediting itself: what they saw goes, and nothing after it.
      const later = commit(worktree, 'more.ts', 'more\n', 'Write more.ts\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>')
      const changes = yield* Changes
      assert.deepStrictEqual(yield* changes.pushBranch(task.taskId, [{ repository: slug, head }]), [{ branch, remote: 'origin' }])
      // What they saw, credited as every push is (Althar's line in), and the later commit not.
      assert.strictEqual(git(remote, 'rev-parse', branch), git(worktree, 'rev-parse', 'HEAD~1'))
      assert.include(git(remote, 'log', '-1', '--format=%B', branch), 'Co-authored-by: Althar')
      assert.include(
        (yield* notices(task.threadId)).map((notice) => notice.title),
        `Pushed ${branch} to origin.`,
      )
      assert.deepInclude(yield* remoteOf, { pushed: true, ahead: 1 })
      // A commit that isn't on the branch, or isn't a commit at all, isn't pushed.
      for (const seen of ['f'.repeat(40), '--force'])
        assert.deepStrictEqual(cantOf(yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: slug, head: seen }]))), [
          'CantMerge',
          'changed',
          '',
        ])
      // The commit the person saw, which crediting rewrote: still what they saw, and the agent's line never leaves.
      yield* changes.pushBranch(task.taskId, [{ repository: slug, head: later }])
      assert.strictEqual(git(remote, 'rev-parse', branch), git(worktree, 'rev-parse', 'HEAD'))
      assert.notInclude(git(remote, 'log', '-1', '--format=%B', branch), 'noreply@anthropic.com')
      assert.deepInclude(yield* remoteOf, { pushed: true, ahead: 0 })
      // The task stays as it was: pushing isn't merging.
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'counts what the remote doesn’t have once it says: not what it has from a push made elsewhere, nor what bringing main in brought',
    () =>
      Effect.gen(function* () {
        const root = repository()
        const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
        git(remote, 'init', '-q', '--bare', '-b', 'main')
        git(root, 'remote', 'add', 'origin', remote)
        git(root, 'push', '-q', '-u', 'origin', 'main')
        const { task, worktrees } = yield* taskIn([root], root)
        const worktree = worktrees[0]?.path ?? ''
        const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
        const queries = yield* Queries
        const changes = yield* Changes
        const remoteOf = Effect.map(queries.thread(task.threadId, {}), (snapshot) => snapshot.task.here[0]?.remote)
        // As the person looks: origin asked where the branch is, and the task read again once it has said.
        const asked = Effect.gen(function* () {
          const head = git(worktree, 'rev-parse', 'HEAD')
          yield* changes.askRemotes(task.taskId)
          yield* changes
            .askedAt(worktree, branch)
            .pipe(Effect.repeat({ until: (at) => at === head, schedule: Schedule.spaced('25 millis') }), Effect.timeout('10 seconds'))
          return yield* remoteOf
        })
        // Its first commit reaches origin from another clone, so nothing here notes it (git from 2.56 notes a push here even by
        // origin's address); then the lead commits again.
        commit(worktree, 'retry.ts', 'retry\n')
        const elsewhere = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
        git(elsewhere, 'clone', '-q', remote, '.')
        git(elsewhere, 'fetch', '-q', root, `refs/heads/${branch}:refs/heads/${branch}`)
        git(elsewhere, 'push', '-q', 'origin', branch)
        commit(worktree, 'more.ts', 'more\n')
        // Until origin says, how much of it origin has isn't known: no count.
        assert.deepInclude(yield* remoteOf, { pushed: false, ahead: null })
        // Asked: only the commit since is new to it.
        assert.deepInclude(yield* asked, { pushed: true, ahead: 1 })
        // Main moves on, on origin too, and the lead brings it in: main's commit origin has, so only the merge is new.
        commit(root, 'theirs.ts', 'theirs\n')
        git(root, 'push', '-q', 'origin', 'main')
        git(worktree, 'merge', '-q', '--no-edit', 'main')
        assert.deepInclude(yield* asked, { pushed: true, ahead: 2 })
        // Pushed from here, git notes it: all of it there, known without asking.
        git(worktree, 'push', '-q', 'origin', branch)
        assert.deepInclude(yield* remoteOf, { pushed: true, ahead: 0 })
        // Its branch gone from origin, as once deleted there, and the lead commits again: none of its own commits is there now.
        git(remote, 'branch', '-q', '-D', branch)
        commit(worktree, 'last.ts', 'last\n')
        assert.deepInclude(yield* asked, { pushed: false, ahead: 4 })
      }).pipe(Effect.provide(withQueries())),
  )

  it.live('pushes to origin where the default branch follows a branch here rather than a remote', () =>
    Effect.gen(function* () {
      const root = repository()
      const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'add', 'origin', remote)
      git(root, 'branch', 'trunk')
      git(root, 'config', 'branch.main.remote', '.')
      git(root, 'config', 'branch.main.merge', 'refs/heads/trunk')
      const { task, worktrees } = yield* taskIn([root], root)
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      const branch = git(worktrees[0]?.path ?? '', 'rev-parse', '--abbrev-ref', 'HEAD')
      const queries = yield* Queries
      assert.strictEqual((yield* queries.thread(task.threadId, {})).task.here[0]?.remote?.name, 'origin')
      yield* (yield* Changes).pushBranch(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.strictEqual(git(remote, 'rev-parse', branch), git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'))
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
      assert.strictEqual(git(remotes[0] ?? '', 'rev-parse', 'main'), git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'))
      assert.notStrictEqual(git(remotes[0] ?? '', 'rev-parse', 'main'), head)
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
      assert.strictEqual(parents[2], git(worktree, 'rev-parse', 'HEAD'))
      assert.include(git(root, 'show', '-s', '--format=%B', 'main^2'), coAuthorLine)
      assert.include(git(root, 'show', '--format=%B', '-s', 'main'), 'Add a retry')
      assert.include(git(root, 'ls-tree', '--name-only', 'main'), 'retry.ts')
      // The person's own branch and files are as they were.
      assert.strictEqual(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'mine')
      assert.isFalse(existsSync(join(root, 'retry.ts')))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges nothing when it conflicts, or the branch moved since it was seen', () =>
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
      // Asked without the head seen in it, a repository hasn't been seen.
      const unseen = yield* Effect.flip(mergeHere(task.taskId, []))
      assert.strictEqual(cantOf(unseen)[1], 'changed')
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('moves a checkout past changes to files the merge leaves alone, as git would, and keeps them as they were', () =>
    Effect.gen(function* () {
      const root = repository()
      commit(root, 'app.ts', 'app\n')
      commit(root, 'notes.md', 'notes\n')
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const head = commit(worktree, 'app.ts', 'app, retried\n')
      // The person's own work, in files the task didn't change: one edited, one staged, one git doesn't track.
      writeFileSync(join(root, 'notes.md'), 'notes, half written\n')
      writeFileSync(join(root, 'README.md'), '# Meridian, renamed\n')
      git(root, 'add', 'README.md')
      writeFileSync(join(root, 'scratch.txt'), 'scratch\n')
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.strictEqual(git(root, 'rev-parse', 'main'), git(worktree, 'rev-parse', 'HEAD'))
      assert.strictEqual(readFileSync(join(root, 'app.ts'), 'utf8'), 'app, retried\n')
      assert.strictEqual(readFileSync(join(root, 'notes.md'), 'utf8'), 'notes, half written\n')
      assert.strictEqual(readFileSync(join(root, 'scratch.txt'), 'utf8'), 'scratch\n')
      assert.strictEqual(git(root, 'diff', '--cached', '--name-only'), 'README.md')
      assert.strictEqual(git(root, 'diff', '--name-only'), 'notes.md')
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges nothing where the checkout has changes not committed to a file the merge changes, staged or not, and says which', () =>
    Effect.gen(function* () {
      const root = repository()
      commit(root, 'app.ts', 'app\n')
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      const slug = worktrees[0]?.slug ?? ''
      const head = commit(worktree, 'app.ts', 'app, retried\n')
      const tip = git(root, 'rev-parse', 'main')
      writeFileSync(join(root, 'app.ts'), 'app, mine\n')
      writeFileSync(join(root, 'README.md'), '# Not yet\n')
      const busy = yield* Effect.flip(mergeHere(task.taskId, [{ repository: slug, head }]))
      assert.deepStrictEqual(inTheWayOf(busy), ['busy', realpathSync(root), 'main', ['app.ts']])
      git(root, 'add', 'app.ts')
      const staged = yield* Effect.flip(mergeHere(task.taskId, [{ repository: slug, head }]))
      assert.deepStrictEqual(inTheWayOf(staged), ['busy', realpathSync(root), 'main', ['app.ts']])
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(readFileSync(join(root, 'app.ts'), 'utf8'), 'app, mine\n')
      assert.strictEqual(readFileSync(join(root, 'README.md'), 'utf8'), '# Not yet\n')
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges nothing where a file not committed since it was planned is one the merge changes, and puts nothing back wrong', () =>
    Effect.gen(function* () {
      const root = repository()
      commit(root, 'app.ts', 'app\n')
      const { worktrees } = yield* taskIn([root], root)
      const head = commit(worktrees[0]?.path ?? '', 'app.ts', 'app, retried\n')
      const tip = git(root, 'rev-parse', 'main')
      writeFileSync(join(root, 'README.md'), '# Not yet\n')
      const plan = yield* planMerge(root, 'main', head, 'Merge')
      if (plan.kind !== 'move') return assert.fail(`planned ${plan.kind}`)
      writeFileSync(join(root, 'app.ts'), 'app, mine\n')
      assert.deepStrictEqual((yield* applyMerges([{ root, branch: 'main', plan }]))?.problem, {
        kind: 'busy',
        checkout: realpathSync(root),
        files: ['app.ts'],
        untracked: [],
      })
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(readFileSync(join(root, 'app.ts'), 'utf8'), 'app, mine\n')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges where a submodule it leaves alone can’t be read, and leaves that submodule as it is', () =>
    Effect.gen(function* () {
      const root = repository()
      withLibrary(root)
      const { task, worktrees } = yield* taskIn([root], root)
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      // library's index is broken: git's status of the project fails inside it, as the person's did.
      const index = join(root, '.git', 'modules', 'library', 'index')
      writeFileSync(index, 'broken')
      assert.throws(() => git(root, 'status', '--porcelain'), /'git status --porcelain=2' failed in submodule library/)
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.strictEqual(git(root, 'rev-parse', 'main'), git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'))
      assert.isTrue(existsSync(join(root, 'retry.ts')))
      assert.strictEqual(readFileSync(index, 'utf8'), 'broken')
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges nothing where it moves a submodule with changes not committed, not at its commit, or that can’t be read', () =>
    Effect.gen(function* () {
      const root = repository()
      const library = withLibrary(root)
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      // The task moves library on: a commit in library's repository, recorded on the task's branch.
      const was = git(library, 'rev-parse', 'HEAD')
      const next = git(library, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Next')
      git(worktree, 'update-index', '--cacheinfo', `160000,${next},library`)
      git(worktree, 'commit', '-q', '-m', 'Move library on')
      const head = git(worktree, 'rev-parse', 'HEAD')
      const tip = git(root, 'rev-parse', 'main')
      const refusal = () => Effect.map(Effect.flip(mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])), cantOf)
      const there = join(realpathSync(root), 'library')
      // The person's git is told to ignore submodules: its diff leaves library out, the merge reads it all the same.
      git(root, 'config', 'diff.ignoreSubmodules', 'all')
      assert.strictEqual(git(root, 'diff', '--raw', tip, head), '')
      writeFileSync(join(library, 'README.md'), '# Not yet\n')
      assert.deepStrictEqual((yield* refusal()).slice(1), ['submodule', there])
      git(library, 'checkout', '-q', '--', 'README.md')
      git(library, 'checkout', '-q', next)
      assert.deepStrictEqual((yield* refusal()).slice(1), ['submodule', there])
      git(library, 'checkout', '-q', 'main')
      const modules = join(root, '.git', 'modules', 'library')
      renameSync(modules, `${modules}.away`)
      const [, why, detail] = yield* refusal()
      assert.strictEqual(why, 'unreadable')
      assert.isTrue(detail?.startsWith(`${there}\n`))
      renameSync(`${modules}.away`, modules)
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
      // Clean when planned, changed before anything moves: nothing moves.
      const plan = yield* planMerge(root, 'main', head, 'Merge')
      if (plan.kind !== 'move') return assert.fail(`planned ${plan.kind}`)
      writeFileSync(join(library, 'README.md'), '# Not yet\n')
      assert.deepStrictEqual((yield* applyMerges([{ root, branch: 'main', plan }]))?.problem, {
        kind: 'submodule',
        checkout: realpathSync(root),
        submodule: there,
      })
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      git(library, 'checkout', '-q', '--', 'README.md')
      // Clean and at its commit, it merges: the record moves, library's checkout stays where it was.
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.include(git(root, 'ls-tree', 'main', 'library'), next)
      assert.strictEqual(git(library, 'rev-parse', 'HEAD'), was)
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('merges a submodule it adds where the checkout has a repository of its own, and leaves that as it is', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, worktrees } = yield* taskIn([root], root)
      const worktree = worktrees[0]?.path ?? ''
      // The person's own clone of library, at one commit with a change not committed; the task records another.
      const library = join(root, 'library')
      mkdirSync(library)
      git(library, 'init', '-q', '-b', 'main')
      const was = commit(library, 'README.md', '# Library\n')
      const next = git(library, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Next')
      writeFileSync(join(library, 'README.md'), '# Not yet\n')
      git(worktree, 'update-index', '--add', '--cacheinfo', `160000,${next},library`)
      git(worktree, 'commit', '-q', '-m', 'Add library')
      const head = git(worktree, 'rev-parse', 'HEAD')
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.include(git(root, 'ls-tree', 'main', 'library'), next)
      assert.strictEqual(git(library, 'rev-parse', 'HEAD'), was)
      assert.strictEqual(readFileSync(join(library, 'README.md'), 'utf8'), '# Not yet\n')
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
    }).pipe(Effect.provide(runtime())),
  )

  // Not on Windows: the older git stands in as a shell script on the PATH.
  it.live.skipIf(windows)('fast-forwards with a git older than 2.36, which has no `worktree list -z`', () => {
    // git as 2.35 had it, in front of the real one: no `worktree list -z` (2.36), no `merge-tree --write-tree` (2.38).
    const shim = realpathSync(mkdtempSync(join(tmpdir(), 'althar-old-git-')))
    const real = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
    writeFileSync(
      join(shim, 'git'),
      [
        '#!/bin/sh',
        'case " $* " in',
        `  *" worktree "*" -z "*) echo "error: unknown switch \\\`z'" >&2; exit 129 ;;`,
        '  *" --write-tree "*) echo "usage: git merge-tree <base-tree> <branch1> <branch2>" >&2; exit 129 ;;',
        'esac',
        `exec '${real}' "$@"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    const path = process.env.PATH
    return Effect.gen(function* () {
      process.env.PATH = `${shim}:${path ?? ''}`
      const root = repository()
      assert.throws(() => git(root, 'worktree', 'list', '--porcelain', '-z'), /unknown switch/)
      const { task, worktrees } = yield* taskIn([root], root)
      const head = commit(worktrees[0]?.path ?? '', 'retry.ts', 'retry\n')
      yield* mergeHere(task.taskId, [{ repository: worktrees[0]?.slug ?? '', head }])
      assert.strictEqual(git(root, 'rev-parse', 'main'), git(worktrees[0]?.path ?? '', 'rev-parse', 'HEAD'))
      assert.isTrue(existsSync(join(root, 'retry.ts')))
      assert.strictEqual(yield* stateOf(task.taskId), 'done')
    }).pipe(Effect.ensuring(Effect.sync(() => (process.env.PATH = path))), Effect.provide(runtime()))
  })

  // Not on Windows: Windows names allow no newline.
  it.live.skipIf(windows)('finds the worktree that has a branch whatever its path', () =>
    Effect.gen(function* () {
      const root = repository()
      const head = git(root, 'rev-parse', 'HEAD')
      // Paths git allows that, listed as lines, would read as an empty line, or as an empty line and a record of their own.
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-odd-')))
      const odd = ['two\n\nlines', `ends\n\nHEAD ${head}`, 'ends in a newline\n']
      for (const [at, name] of odd.entries()) {
        git(root, 'branch', `side-${at}`)
        git(root, 'worktree', 'add', '-q', join(folder, name), `side-${at}`)
      }
      for (const [at, name] of odd.entries()) assert.strictEqual(yield* checkedOut(root, `side-${at}`), join(folder, name))
      assert.strictEqual(yield* checkedOut(root, 'main'), realpathSync(root))
      git(root, 'branch', 'free')
      assert.isNull(yield* checkedOut(root, 'free'))
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
      // Refused, nothing was rewritten under the heads seen; merged, each main is its task branch, credited.
      assert.deepStrictEqual(
        roots.map((root) => git(root, 'rev-parse', 'main')),
        worktrees.map((worktree) => git(worktree.path, 'rev-parse', 'HEAD')),
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
      assert.deepStrictEqual(inTheWayOf(refused), ['untracked', roots[1] ?? '', 'web’s main', ['new.ts']])
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
      // In the order given, web's checkout moves before docs' refuses: it is put back too, its files as they were.
      const undone = yield* applyMerges(moves)
      assert.strictEqual(undone?.root, other)
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.before),
      )
      assert.strictEqual(git(open ?? '', 'status', '--porcelain'), '')
      assert.isFalse(existsSync(join(open ?? '', 'retry.ts')))
      // A ref that moved since the plan refuses as well, and nothing else moves.
      git(other ?? '', 'clean', '-q', '-f')
      git(bare ?? '', 'update-ref', 'refs/heads/main', git(bare ?? '', 'rev-parse', 'task'))
      assert.strictEqual((yield* applyMerges(moves))?.root, bare)
      assert.deepStrictEqual(
        moves.slice(1).map((move) => git(move.root, 'rev-parse', 'main')),
        moves.slice(1).map((move) => move.before),
      )
      // A checkout switched to another branch since the plan, clean and able to fast-forward: nothing moves, that branch neither.
      git(bare ?? '', 'update-ref', 'refs/heads/main', moves[0]?.before ?? '')
      git(open ?? '', 'checkout', '-q', '-b', 'elsewhere', 'main')
      const switched = yield* applyMerges(moves)
      assert.strictEqual(switched?.root, open)
      assert.deepStrictEqual(switched?.problem, { kind: 'moved' })
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.before),
      )
      assert.strictEqual(git(open ?? '', 'rev-parse', 'elsewhere'), moves[1]?.before)
      git(open ?? '', 'checkout', '-q', 'main')
      // A branch checked out nowhere when planned, checked out since: its ref doesn't move from under that checkout.
      git(bare ?? '', 'checkout', '-q', 'main')
      const attached = yield* applyMerges(moves)
      assert.strictEqual(attached?.root, bare)
      assert.deepStrictEqual(attached?.problem, { kind: 'moved' })
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.before),
      )
      git(bare ?? '', 'checkout', '-q', 'mine')
      // A checkout whose status can't be read now: nothing moves, and it says why.
      writeFileSync(join(open ?? '', '.git', 'index'), 'not an index')
      const unreadable = yield* applyMerges(moves)
      assert.strictEqual(unreadable?.root, open)
      assert.strictEqual(unreadable?.problem?.kind, 'unreadable')
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.before),
      )
      rmSync(join(open ?? '', '.git', 'index'))
      git(open ?? '', 'reset', '-q')
      // Nothing in the way, every one moves.
      assert.isNull(yield* applyMerges(moves))
      assert.deepStrictEqual(
        moves.map((move) => git(move.root, 'rev-parse', 'main')),
        moves.map((move) => move.plan.to),
      )
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a merge here, worked out', () => {
  it.live('is nothing to do for a branch the repository doesn’t have, or one that has the commit already', () =>
    Effect.gen(function* () {
      const root = repository()
      git(root, 'checkout', '-q', '-b', 'task')
      const head = commit(root, 'retry.ts', 'retry\n')
      git(root, 'checkout', '-q', 'main')
      assert.deepStrictEqual(yield* planMerge(root, 'nope', head, 'Merge'), { kind: 'missing' })
      // Whether it would conflict can't be told.
      assert.isNull(yield* conflictsOf(root, 'nope', head))
      assert.isNull(yield* checkedOut(root, 'nope'))
      // Once main has it, merging it again is nothing to do.
      git(root, 'merge', '-q', '--ff-only', 'task')
      assert.deepStrictEqual(yield* planMerge(root, 'main', head, 'Merge'), { kind: 'already' })
    }),
  )

  it.live('finds the files that conflict without moving anything, and none where it merges cleanly', () =>
    Effect.gen(function* () {
      const root = repository()
      git(root, 'checkout', '-q', '-b', 'task')
      const head = commit(root, 'README.md', '# Retry\n')
      git(root, 'checkout', '-q', 'main')
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', head), [])
      const tip = commit(root, 'README.md', '# Rate limits\n')
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', head), ['README.md'])
      assert.deepStrictEqual(yield* planMerge(root, 'main', head, 'Merge'), { kind: 'conflicts', files: ['README.md'] })
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(git(root, 'status', '--porcelain'), '')
    }),
  )

  it.live('is put back only while the checkout is where the merge left it, never over what came since', () =>
    Effect.gen(function* () {
      const root = repository()
      git(root, 'checkout', '-q', '-b', 'task')
      const head = commit(root, 'retry.ts', 'retry\n')
      git(root, 'checkout', '-q', 'main')
      const before = git(root, 'rev-parse', 'main')
      const plan = yield* planMerge(root, 'main', head, 'Merge')
      if (plan.kind !== 'move') return assert.fail(`planned ${plan.kind}`)
      yield* applyMerge(root, 'main', plan)
      assert.strictEqual(git(root, 'rev-parse', 'main'), head)
      // The person committed on top since: undoing leaves their work where it is.
      const theirs = commit(root, 'notes.md', 'mine\n')
      assert.strictEqual(yield* undoMerge(root, 'main', plan), '')
      assert.strictEqual(git(root, 'rev-parse', 'main'), theirs)
      // Where it is still as the merge left it, it goes back.
      git(root, 'reset', '-q', '--hard', head)
      yield* undoMerge(root, 'main', plan)
      assert.strictEqual(git(root, 'rev-parse', 'main'), before)
      assert.isFalse(existsSync(join(root, 'retry.ts')))
    }),
  )

  it.live('moves a submodule the checkout doesn’t have checked out, which it leaves as it is', () =>
    Effect.gen(function* () {
      const root = repository()
      const library = withLibrary(root)
      const next = git(library, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Next')
      // Not checked out here: nothing of it could be left behind.
      git(root, 'submodule', 'deinit', '-q', '-f', 'library')
      git(root, 'checkout', '-q', '-b', 'task')
      git(root, 'update-index', '--cacheinfo', `160000,${next},library`)
      git(root, 'commit', '-q', '-m', 'Move library on')
      const head = git(root, 'rev-parse', 'HEAD')
      git(root, 'checkout', '-q', 'main')
      const plan = yield* planMerge(root, 'main', head, 'Merge')
      assert.deepInclude(plan, { kind: 'move', to: head, fastForward: true, checkout: realpathSync(root) })
    }),
  )
})
