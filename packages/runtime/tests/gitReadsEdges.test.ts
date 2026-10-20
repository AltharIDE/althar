import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotARepository } from '../src/errors'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * What a task's screens read from git where its repository isn't as Althar
 * set it up: a branch started over on a history of its own, a default
 * branch the person renamed, and one merged here that follows a remote
 * branch this Mac never fetched. And a project opened from a folder that
 * isn't a repository's root.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A project of a repository, at `root`, and a task in it: its thread and its worktree. */
const taskIn = (root: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Add a retry',
    })
    const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${task.taskId}`
    return { threadId: task.threadId, worktree: workspace?.path ?? '', branch: workspace?.branch ?? '' }
  })

const shownOf = (threadId: string) =>
  Effect.flatMap(Queries, (queries) =>
    Effect.map(queries.thread(threadId, {}), (snapshot) => ({
      files: snapshot.task.files.map((file) => [file.path, file.status]),
      commits: snapshot.task.commits,
      here: snapshot.task.here.map((one) => one.branch),
      merged: snapshot.task.merged,
    })),
  )

describe('what a task’s screens read from git', () => {
  it.live('counts a branch started over on a history of its own from where its worktree started', () =>
    Effect.gen(function* () {
      const { threadId, worktree, branch } = yield* taskIn(repository())
      // The lead starts its branch over with no history in common with main, keeping the files it has.
      git(worktree, 'checkout', '-q', '--orphan', 'fresh')
      commit(worktree, 'retry.ts', 'retry\n')
      git(worktree, 'branch', '-q', '-M', branch)
      assert.deepStrictEqual(yield* shownOf(threadId), { files: [['retry.ts', 'added']], commits: 1, here: ['main'], merged: [] })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('counts what a task changed from where it started once the person renames the default branch', () =>
    Effect.gen(function* () {
      const root = repository()
      const { threadId, worktree } = yield* taskIn(root)
      commit(worktree, 'retry.ts', 'retry\n')
      git(root, 'branch', '-q', '-m', 'main', 'trunk')
      assert.deepInclude(yield* shownOf(threadId), { files: [['retry.ts', 'added']], commits: 1 })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says a task merged here is ahead of nothing on a remote branch this Mac never fetched', () =>
    Effect.gen(function* () {
      const root = repository()
      const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(bare, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'add', 'origin', bare)
      git(root, 'config', 'branch.main.remote', 'origin')
      git(root, 'config', 'branch.main.merge', 'refs/heads/main')
      const { threadId, worktree } = yield* taskIn(root)
      const head = commit(worktree, 'retry.ts', 'retry\n')
      git(root, 'merge', '-q', '--ff-only', head)
      const shown = yield* shownOf(threadId)
      assert.deepStrictEqual(shown.here, [])
      assert.deepStrictEqual(
        shown.merged.map((one) => [one.branch, one.remote, one.ahead]),
        [['main', 'origin/main', 0]],
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a project opened with repositories named', () => {
  it.live('takes none that is a folder inside a repository rather than its root', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const root = repository()
      const inside = join(root, 'src')
      mkdirSync(inside)
      const folder = mkdtempSync(join(tmpdir(), 'althar-folder-'))
      const refused = yield* Effect.flip(
        projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder, repositories: [inside] }),
      )
      assert.instanceOf(refused, NotARepository)
      // Named with its root, the root is taken, once.
      const opened = yield* projects.open({
        envelope: yield* Runtime.envelope('project.open', {}),
        path: folder,
        repositories: [inside, root, root],
      })
      assert.lengthOf(yield* projects.repositories(opened.projectId), 1)
    }).pipe(Effect.provide(runtime())),
  )
})
