import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * Merging a task here, and publishing it, where there is nothing to act on:
 * a task there isn't, a default branch the repository no longer has, a
 * next pull request with nothing after the last, and a conflict on a task
 * whose work never ran, which no lead is asked to resolve.
 */

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

/** A project of a new repository, a task in it with no lead, and the task's worktree: none has ever run on it. */
const plainTask = Effect.gen(function* () {
  const root = repository()
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Add a retry',
  })
  const sql = yield* SqlClient.SqlClient
  const [worktree] = yield* sql<{ slug: string; path: string }>`
    SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId}`
  return { root, projectId: project.projectId as ProjectId, task, slug: worktree?.slug ?? '', worktree: worktree?.path ?? '' }
})

const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

describe('merging a task here, with nothing to merge into', () => {
  it.live('finds no task there isn’t, and says which default branch the repository no longer has', () =>
    Effect.gen(function* () {
      const changes = yield* Changes
      assert.instanceOf(yield* Effect.flip(changes.mergeHere('task_none', [])), NotFound)
      const { root, task, slug, worktree } = yield* plainTask
      const head = commit(worktree, 'retry.ts', 'retry\n')
      // The person renamed main since the task started from it.
      const before = git(root, 'rev-parse', 'main')
      git(root, 'branch', '-m', 'main', 'trunk')
      assert.deepStrictEqual(cantOf(yield* Effect.flip(changes.mergeHere(task.taskId, [{ repository: slug, head }]))), [
        'CantMerge',
        'missing',
        'main',
      ])
      // Nothing moved.
      assert.strictEqual(git(root, 'rev-parse', 'trunk'), before)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('publishes no task there isn’t, nor a next pull request with nothing after the last', () =>
    Effect.gen(function* () {
      const changes = yield* Changes
      const { projectId, task } = yield* plainTask
      assert.instanceOf(yield* Effect.flip(changes.publish({ projectId, taskId: 'task_none', runId: 'run_none', end: 'draft' })), NotFound)
      const refused = yield* Effect.flip(changes.publish({ projectId, taskId: task.taskId, runId: 'run_none', end: 'draft', again: true }))
      assert.deepStrictEqual(cantOf(refused).slice(0, 2), ['NoChangeToOpen', 'nothing'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('leaves a conflict to the person where the task’s work never ran, though its project has its leads resolve conflicts', () =>
    Effect.gen(function* () {
      const changes = yield* Changes
      const { root, projectId, task, slug, worktree } = yield* plainTask
      yield* (yield* Policies).set(projectId, { resolveConflicts: true }, (yield* Instance).personId)
      const head = commit(worktree, 'README.md', '# Retry\n')
      commit(root, 'README.md', '# Rate limits\n')
      assert.deepStrictEqual(cantOf(yield* Effect.flip(changes.mergeHere(task.taskId, [{ repository: slug, head }]))), [
        'CantMerge',
        'conflicts',
        'README.md',
      ])
      const sql = yield* SqlClient.SqlClient
      assert.lengthOf(yield* sql`SELECT id FROM conflict_resolutions WHERE task_id = ${task.taskId}`, 0)
    }).pipe(Effect.provide(runtime())),
  )
})
