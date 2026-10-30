import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Conflict } from '../src/conflicts'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { hosted, runtime, until } from './support'
import { asked, git, opened, rounds, runtimeWith } from './conflictsSupport'

/*
 * Conflict rounds where conflicts.test.ts and conflictsOnHost.test.ts don't
 * go: one the host reports against a branch gone from its remote, which
 * isn't the lead's to resolve; and a round across two repositories left
 * under way when Althar stopped, settled with why for each.
 */

describe('a conflict its pull request’s host reports', () => {
  it.live('isn’t the lead’s to resolve where the branch it conflicts with is gone from the remote', () => {
    const { working, bare } = hosted()
    let asks = 0
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: () => {
        try {
          return git(bare, 'rev-parse', 'althar/add-a-retry')
        } catch {
          return null
        }
      },
      // The host says it conflicts with main, which the remote no longer has.
      conflictsOf: () => {
        asks += 1
        return true
      },
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/althar/add-a-retry')
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      git(bare, 'branch', '-q', '-D', 'main')
      const seen = asks
      // Asked again, more than once, as Althar listens to the pull request.
      yield* until(
        Effect.sync(() => [asks]),
        ([now]) => (now ?? 0) >= seen + 3,
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a round across two repositories that an earlier launch left under way', () => {
  it.live('is settled with why for each, once their worktrees have gone', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-conflicts-')), 'althar.sqlite')
    const launch = () => Queries.layer.pipe(Layer.provideMerge(runtime(file)))
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
    for (const name of ['api', 'web']) {
      mkdirSync(join(folder, name))
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: join(folder, name) })
      writeFileSync(join(folder, name, 'README.md'), `# ${name}\n`)
      git(join(folder, name), 'add', '.')
      git(join(folder, name), 'commit', '-q', '-m', 'Start')
    }
    return Effect.gen(function* () {
      const { taskId, paths } = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Share the retry',
          repositories: ['api', 'web'],
        })
        const worktrees = yield* until(
          sql<{ slug: string; name: string; path: string; state: string }>`
            SELECT b.slug, b.display_name AS name, w.path, w.state FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${task.taskId} ORDER BY b.created_at, b.rowid`,
          (rows) => rows.length === 2 && rows.every((row) => row.state === 'ready'),
        )
        // Its lead was resolving a conflict with main in each, where its branch already is, when Althar stopped.
        const conflicts: ReadonlyArray<Conflict> = worktrees.map((worktree) => {
          const head = git(worktree.path, 'rev-parse', 'HEAD')
          return {
            repository: worktree.slug,
            name: worktree.name,
            branch: 'main',
            ref: 'main',
            target: head,
            from: head,
            files: ['README.md'],
          }
        })
        const at = new Date().toISOString()
        yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
          id: `cres_${randomBytes(16).toString('hex')}`,
          projectId: project.projectId,
          taskId: task.taskId,
          pullRequestUrl: null,
          conflicts: JSON.stringify(conflicts),
          attempt: 1,
          state: 'resolving',
          createdAt: at,
          updatedAt: at,
        })}`
        return { taskId: task.taskId, paths: worktrees.map((worktree) => worktree.path) }
      }).pipe(Effect.provide(launch()))
      // Meanwhile both worktrees went.
      for (const path of paths) rmSync(path, { recursive: true, force: true })

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [ended] = yield* until(
          sql<{ state: string; failure: string | null }>`SELECT state, failure FROM conflict_resolutions WHERE task_id = ${taskId}`,
          (rows) => rows.every((row) => row.state !== 'resolving'),
        )
        assert.deepStrictEqual(ended, {
          state: 'failed',
          failure: 'Althar stopped while the lead was resolving it. api: Its worktree is gone. web: Its worktree is gone.',
        })
      }).pipe(Effect.provide(launch()))
    })
  })
})
